"use client";

import {
  CalendarCapabilityAuthorizationResponseSchema,
  PutAvailabilityRulesRequestSchema,
  PutAvailabilityRulesResponseSchema,
  type AvailabilityRuleSnapshot,
  type CalendarCapabilityStatus,
  type WeeklyAvailabilityInterval,
  type WeeklyAvailabilityIntervals
} from "@vera/domain";
import { useMemo, useState, type FormEvent } from "react";

interface AvailabilityEditorProps {
  readonly initialRules: AvailabilityRuleSnapshot;
  readonly conflictCheckingStatus: CalendarCapabilityStatus;
}

const weekdays = [
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["7", "Sunday"]
] as const satisfies readonly (readonly [keyof WeeklyAvailabilityIntervals, string])[];

function supportedTimeZones(current: string): readonly string[] {
  const supported = Intl.supportedValuesOf("timeZone");
  return supported.includes(current) ? supported : [current, ...supported];
}

function safeResponseMessage(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null) return fallback;
  const message = Reflect.get(value, "message");
  return typeof message === "string" && message.length <= 500 ? message : fallback;
}

export function AvailabilityEditor({
  initialRules,
  conflictCheckingStatus
}: AvailabilityEditorProps) {
  const [rules, setRules] = useState(initialRules);
  const [reminders, setReminders] = useState(initialRules.remindersMinutesBeforeStart.join(", "));
  const [pending, setPending] = useState<"save" | "authorize" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const timeZones = useMemo(() => supportedTimeZones(rules.timeZone), [rules.timeZone]);

  function updateWeekday(
    weekday: keyof WeeklyAvailabilityIntervals,
    intervals: readonly WeeklyAvailabilityInterval[]
  ): void {
    setRules((current) => ({
      ...current,
      weeklyIntervals: { ...current.weeklyIntervals, [weekday]: [...intervals] }
    }));
    setStatus(null);
  }

  function updateInterval(
    weekday: keyof WeeklyAvailabilityIntervals,
    index: number,
    field: keyof WeeklyAvailabilityInterval,
    value: string
  ): void {
    const next = rules.weeklyIntervals[weekday].map((interval, intervalIndex) =>
      intervalIndex === index ? { ...interval, [field]: value } : interval
    );
    updateWeekday(weekday, next);
  }

  async function authorizeConflictChecking(): Promise<void> {
    setPending("authorize");
    setError(null);
    try {
      const response = await fetch("/api/integrations/google/calendar/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: "calendar_conflict_checking",
          returnTo: "/settings/availability"
        })
      });
      const body = (await response.json()) as unknown;
      const parsed = CalendarCapabilityAuthorizationResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(safeResponseMessage(body, "Calendar conflict checking could not connect."));
      }
      window.location.assign(parsed.data.authorizationUrl);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Calendar conflict checking could not connect."
      );
      setPending(null);
    }
  }

  function toggleConflictChecking(enabled: boolean): void {
    setStatus(null);
    if (enabled && conflictCheckingStatus.state !== "granted") {
      void authorizeConflictChecking();
      return;
    }
    setRules((current) => ({
      ...current,
      conflictCheckingEnabled: enabled,
      calendarIds: enabled ? ["primary"] : []
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending("save");
    setError(null);
    setStatus(null);

    const reminderValues =
      reminders.trim().length === 0
        ? []
        : reminders.split(",").map((value) => Number(value.trim()));
    const request = PutAvailabilityRulesRequestSchema.safeParse({
      ...rules,
      remindersMinutesBeforeStart: reminderValues
    });
    if (!request.success) {
      setError(request.error.issues.map((issue) => issue.message).join(" "));
      setPending(null);
      return;
    }

    try {
      const response = await fetch("/api/availability/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data)
      });
      const body = (await response.json()) as unknown;
      const parsed = PutAvailabilityRulesResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new Error(safeResponseMessage(body, "Viewing availability could not be saved."));
      }
      const saved = parsed.data.rules;
      setRules({
        timeZone: saved.timeZone,
        weeklyIntervals: saved.weeklyIntervals,
        durationMinutes: saved.durationMinutes,
        minimumNoticeMinutes: saved.minimumNoticeMinutes,
        travelMinutes: saved.travelMinutes,
        bufferMinutes: saved.bufferMinutes,
        remindersMinutesBeforeStart: saved.remindersMinutesBeforeStart,
        conflictCheckingEnabled: saved.conflictCheckingEnabled,
        calendarIds: saved.calendarIds,
        schemaVersion: saved.schemaVersion
      });
      setReminders(saved.remindersMinutesBeforeStart.join(", "));
      setStatus("Viewing availability saved.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Viewing availability could not be saved."
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="weekly-rules-heading">
      {error === null ? null : (
        <div className="settings-error" role="alert" tabIndex={-1}>
          <strong>Check your availability rules.</strong>
          <span>{error}</span>
        </div>
      )}
      <p className="settings-status" role="status" aria-live="polite">
        {status}
      </p>

      <form className="availability-form" onSubmit={(event) => void save(event)} noValidate>
        <div className="availability-form-heading">
          <div>
            <p className="eyebrow">Weekly rules</p>
            <h2 id="weekly-rules-heading">Times Vera may suggest</h2>
          </div>
          <label className="settings-field timezone-field">
            <span>Timezone</span>
            <select
              value={rules.timeZone}
              onChange={(event) => {
                setRules((current) => ({ ...current, timeZone: event.target.value }));
                setStatus(null);
              }}
            >
              {timeZones.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="weekday-list">
          {weekdays.map(([weekday, label]) => (
            <fieldset className="weekday-fieldset" key={weekday}>
              <legend>{label}</legend>
              <div className="weekday-intervals">
                {rules.weeklyIntervals[weekday].length === 0 ? (
                  <p className="weekday-empty">No viewing times</p>
                ) : null}
                {rules.weeklyIntervals[weekday].map((interval, index) => (
                  <div className="time-range" key={`${weekday}-${index}`}>
                    <label>
                      <span className="sr-only">{label} start time</span>
                      <input
                        type="time"
                        step={900}
                        value={interval.startsAt}
                        onChange={(event) =>
                          updateInterval(weekday, index, "startsAt", event.target.value)
                        }
                      />
                    </label>
                    <span aria-hidden="true">to</span>
                    <label>
                      <span className="sr-only">{label} end time</span>
                      <input
                        type="time"
                        step={900}
                        value={interval.endsAt}
                        onChange={(event) =>
                          updateInterval(weekday, index, "endsAt", event.target.value)
                        }
                      />
                    </label>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        updateWeekday(
                          weekday,
                          rules.weeklyIntervals[weekday].filter(
                            (_interval, intervalIndex) => intervalIndex !== index
                          )
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() =>
                  updateWeekday(weekday, [
                    ...rules.weeklyIntervals[weekday],
                    { startsAt: "17:30", endsAt: "19:30" }
                  ])
                }
              >
                Add time
              </button>
            </fieldset>
          ))}
        </div>

        <fieldset className="viewing-rules-fieldset">
          <legend>Viewing timing</legend>
          <div className="settings-field-grid">
            <label className="settings-field">
              <span>Viewing duration</span>
              <input
                type="number"
                min={15}
                max={240}
                step={15}
                value={rules.durationMinutes}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    durationMinutes: Number(event.target.value)
                  }))
                }
              />
              <small>Minutes</small>
            </label>
            <label className="settings-field">
              <span>Minimum notice</span>
              <input
                type="number"
                min={0}
                max={10_080}
                step={15}
                value={rules.minimumNoticeMinutes}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    minimumNoticeMinutes: Number(event.target.value)
                  }))
                }
              />
              <small>Minutes before a viewing</small>
            </label>
            <label className="settings-field">
              <span>Travel time</span>
              <input
                type="number"
                min={0}
                max={240}
                step={5}
                value={rules.travelMinutes}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    travelMinutes: Number(event.target.value)
                  }))
                }
              />
              <small>Applied on both sides of a conflict</small>
            </label>
            <label className="settings-field">
              <span>Extra buffer</span>
              <input
                type="number"
                min={0}
                max={240}
                step={5}
                value={rules.bufferMinutes}
                onChange={(event) =>
                  setRules((current) => ({
                    ...current,
                    bufferMinutes: Number(event.target.value)
                  }))
                }
              />
              <small>Applied on both sides of a conflict</small>
            </label>
            <label className="settings-field settings-field-wide">
              <span>Popup reminders</span>
              <input
                inputMode="numeric"
                value={reminders}
                onChange={(event) => setReminders(event.target.value)}
                placeholder="30, 120"
              />
              <small>Comma-separated minutes before a future hold; up to five.</small>
            </label>
          </div>
        </fieldset>

        <fieldset className="conflict-check-fieldset">
          <legend>Google Calendar conflict checking</legend>
          <label className="conflict-check-toggle">
            <input
              type="checkbox"
              aria-describedby="conflict-check-disclosure"
              checked={rules.conflictCheckingEnabled}
              disabled={pending !== null}
              onChange={(event) => toggleConflictChecking(event.target.checked)}
            />
            <span>
              <strong>Check my primary Google Calendar</strong>
              <small id="conflict-check-disclosure">
                Vera uses free/busy blocks only. No event details are read, and no other calendars
                are checked in the founder release.
              </small>
            </span>
          </label>
          <p className={`capability-inline-state capability-state-${conflictCheckingStatus.state}`}>
            Permission: {conflictCheckingStatus.state.replaceAll("_", " ")}
          </p>
          {pending === "authorize" ? (
            <p className="settings-progress" role="status">
              Opening Google’s permission screen…
            </p>
          ) : null}
        </fieldset>

        <div className="availability-actions">
          <button className="primary-button" type="submit" disabled={pending !== null}>
            {pending === "save" ? "Saving…" : "Save viewing availability"}
          </button>
          <p>Saving these rules never requests Calendar event-write access.</p>
        </div>
      </form>
    </section>
  );
}
