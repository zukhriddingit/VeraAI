"use client";

import {
  ApproveCalendarHoldResponseSchema,
  CalendarApiErrorResponseSchema,
  CalendarCapabilityAuthorizationResponseSchema,
  CalendarHoldPreviewResponseSchema,
  CancelViewingResponseSchema,
  CreateViewingProposalsResponseSchema,
  RescheduleViewingResponseSchema,
  SelectViewingWindowResponseSchema,
  type CalendarApiErrorResponse,
  type CalendarCapability,
  type CalendarCapabilityGrantState,
  type CalendarHoldApprovalPreview,
  type ProposedViewingWindow
} from "@vera/domain";
import { useEffect, useId, useRef, useState } from "react";

import {
  approvalIntent,
  formatViewingCheckedAt,
  formatViewingWindow,
  interpretCreateHoldResponse,
  presentViewingPlanner,
  type PlannerRecoveryAction,
  type ViewingPlannerState
} from "./viewing-planner-view.ts";

interface ViewingPlannerProps {
  readonly listingId: string;
  readonly demoMode: boolean;
  readonly holdCapabilityState: CalendarCapabilityGrantState;
  readonly initialState?: ViewingPlannerState;
}

interface SafeSchema<T> {
  safeParse(
    input: unknown
  ): { readonly success: true; readonly data: T } | { readonly success: false };
}

class PlannerRequestError extends Error {
  readonly recoveryAction: PlannerRecoveryAction;
  readonly authorizationCapability: CalendarCapability | null;

  constructor(
    message: string,
    recoveryAction: PlannerRecoveryAction,
    authorizationCapability: CalendarCapability | null = null
  ) {
    super(message);
    this.name = "PlannerRequestError";
    this.recoveryAction = recoveryAction;
    this.authorizationCapability = authorizationCapability;
  }
}

function recoveryAction(error: CalendarApiErrorResponse): PlannerRecoveryAction {
  return error.recovery.action === "none" ? "retry" : error.recovery.action;
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function parseResponse<T>(response: Response, schema: SafeSchema<T>): Promise<T> {
  const body = await responseBody(response);
  if (response.ok) {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
  }
  const error = CalendarApiErrorResponseSchema.safeParse(body);
  if (error.success) {
    throw new PlannerRequestError(
      error.data.message,
      recoveryAction(error.data),
      error.data.recovery.authorizationCapability
    );
  }
  throw new PlannerRequestError(
    "Vera received an invalid Calendar response and stopped safely.",
    "retry"
  );
}

function post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal
  });
}

function put(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function windowKey(window: ProposedViewingWindow): string {
  return `${window.startsAt}/${window.endsAt}`;
}

function errorState(error: unknown): ViewingPlannerState {
  if (error instanceof PlannerRequestError) {
    return {
      kind: "error",
      message: error.message,
      recoveryAction: error.recoveryAction,
      authorizationCapability: error.authorizationCapability
    };
  }
  return {
    kind: "error",
    message: "The Calendar operation did not complete. No success was assumed.",
    recoveryAction: "retry"
  };
}

export function ViewingPlanner({
  listingId,
  demoMode,
  holdCapabilityState,
  initialState
}: ViewingPlannerProps) {
  const [state, setState] = useState<ViewingPlannerState>(initialState ?? { kind: "idle" });
  const [selectedWindowKey, setSelectedWindowKey] = useState<string | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const windowGroupRef = useRef<HTMLFieldSetElement | null>(null);
  const windowGroupId = useId();
  const view = presentViewingPlanner(state, { demoMode });
  const visibleRecoveryOptions = demoMode
    ? view.recoveryOptions.filter(({ action }) => action !== "connect" && action !== "reconnect")
    : view.recoveryOptions;
  const activeViewingId =
    state.kind === "proposals"
      ? state.result.viewing.id
      : state.kind === "conflict_detected"
        ? state.replacementViewingId
        : state.kind === "rescheduled"
          ? state.result.viewing.id
          : null;
  const selectedWindow =
    view.windows.find((window) => windowKey(window) === selectedWindowKey) ?? null;
  const pending =
    requestPending ||
    ["loading_proposals", "loading_preview", "approving", "creating"].includes(state.kind);

  useEffect(() => () => abortRef.current?.abort(), []);

  function start(operation: (signal: AbortSignal) => Promise<void>): void {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRequestPending(true);
    retryRef.current = () => start(operation);
    void operation(controller.signal)
      .catch((error: unknown) => {
        if (!isAbort(error)) setState(errorState(error));
      })
      .finally(() => {
        if (abortRef.current === controller) setRequestPending(false);
      });
  }

  function propose(): void {
    start(async (signal) => {
      setSelectedWindowKey(null);
      setState({ kind: "loading_proposals" });
      const result = await parseResponse(
        await post(`/api/listings/${listingId}/viewings`, {}, signal),
        CreateViewingProposalsResponseSchema
      );
      setState({ kind: "proposals", result });
    });
  }

  async function preparePreview(
    viewingId: string,
    remindersMinutesBeforeStart: readonly number[],
    signal: AbortSignal
  ): Promise<void> {
    setState({ kind: "loading_preview", viewingId });
    const result = await parseResponse(
      await post(
        `/api/viewings/${viewingId}/approval`,
        { contactNotes: null, remindersMinutesBeforeStart },
        signal
      ),
      CalendarHoldPreviewResponseSchema
    );
    setState({ kind: "preview", preview: result.preview });
  }

  function selectAndPreview(viewingId: string, window: ProposedViewingWindow): void {
    start(async (signal) => {
      setState({ kind: "loading_preview", viewingId });
      await parseResponse(
        await post(
          `/api/viewings/${viewingId}/select`,
          { startsAt: window.startsAt, endsAt: window.endsAt },
          signal
        ),
        SelectViewingWindowResponseSchema
      );
      retryRef.current = () =>
        start((retrySignal) =>
          preparePreview(viewingId, window.rules.remindersMinutesBeforeStart, retrySignal)
        );
      await preparePreview(viewingId, window.rules.remindersMinutesBeforeStart, signal);
    });
  }

  async function createApprovedHold(
    preview: CalendarHoldApprovalPreview,
    approvalId: string,
    signal: AbortSignal
  ): Promise<void> {
    setState({ kind: "creating", preview });
    const response = await post(
      `/api/viewings/${preview.viewingId}/hold`,
      {
        approvalId,
        expectedPayloadHash: preview.payloadHash,
        conflictCheckOverride: preview.conflictCheckOverride,
        correlationId: crypto.randomUUID()
      },
      signal
    );
    const interpretation = interpretCreateHoldResponse(
      response.status,
      await responseBody(response)
    );
    if (interpretation.kind === "error") {
      throw new PlannerRequestError(
        interpretation.error.message,
        recoveryAction(interpretation.error),
        interpretation.error.recovery.authorizationCapability
      );
    }
    if (interpretation.kind === "invalid") {
      throw new PlannerRequestError(
        "Vera received an invalid hold result and stopped without assuming success.",
        "retry"
      );
    }
    const result = interpretation.result;
    if (result.kind === "created") {
      setState({ kind: "created", hold: result.hold, duplicate: result.duplicate });
      return;
    }
    if (result.kind === "conflict_detected") {
      setSelectedWindowKey(null);
      setState({
        kind: "conflict_detected",
        replacementViewingId: result.replacementViewingId,
        windows: result.replacementWindows
      });
      return;
    }
    setState({ kind: "confirmation_required", preview: result.overridePreview });
  }

  function approveAndCreate(preview: CalendarHoldApprovalPreview): void {
    start(async (signal) => {
      setState({ kind: "approving", preview });
      const approved = await parseResponse(
        await put(
          `/api/viewings/${preview.viewingId}/approval`,
          { holdId: preview.holdId, expectedPayloadHash: preview.payloadHash },
          signal
        ),
        ApproveCalendarHoldResponseSchema
      );
      retryRef.current = () =>
        start((retrySignal) => createApprovedHold(preview, approved.approval.id, retrySignal));
      await createApprovedHold(preview, approved.approval.id, signal);
    });
  }

  function authorize(capability: CalendarCapability): void {
    if (demoMode) {
      setState({
        kind: "error",
        message: "Demo mode uses a simulated Calendar fixture and cannot connect a Google account.",
        recoveryAction: "retry"
      });
      return;
    }
    start(async (signal) => {
      const result = await parseResponse(
        await post(
          "/api/integrations/google/calendar/authorize",
          { capability, returnTo: `/listings/${listingId}` },
          signal
        ),
        CalendarCapabilityAuthorizationResponseSchema
      );
      window.location.assign(result.authorizationUrl);
    });
  }

  function reschedule(viewingId: string): void {
    start(async (signal) => {
      const result = await parseResponse(
        await post(
          `/api/viewings/${viewingId}/reschedule`,
          { correlationId: crypto.randomUUID() },
          signal
        ),
        RescheduleViewingResponseSchema
      );
      setSelectedWindowKey(null);
      setState({ kind: "rescheduled", result });
    });
  }

  function cancel(viewingId: string): void {
    start(async (signal) => {
      const result = await parseResponse(
        await post(
          `/api/viewings/${viewingId}/cancel`,
          { correlationId: crypto.randomUUID() },
          signal
        ),
        CancelViewingResponseSchema
      );
      setState({ kind: "cancelled", result });
    });
  }

  function handleRecovery(action: PlannerRecoveryAction): void {
    if (action === "connect" || action === "reconnect") {
      const capability =
        state.kind === "error"
          ? state.authorizationCapability
          : state.kind === "proposals"
            ? state.result.recovery.authorizationCapability
            : null;
      authorize(capability ?? "calendar_conflict_checking");
      return;
    }
    if (action === "retry") {
      (retryRef.current ?? propose)();
      return;
    }
    if (action === "edit_availability") {
      window.location.assign("/settings/availability");
      return;
    }
    if (action === "continue_with_warning" && state.kind === "confirmation_required") {
      approveAndCreate(state.preview);
      return;
    }
    windowGroupRef.current?.focus();
  }

  return (
    <section className="detail-panel viewing-planner" aria-labelledby={`${windowGroupId}-heading`}>
      <div className="viewing-planner-heading">
        <div>
          <p className="eyebrow">User-approved Calendar action</p>
          <h2 id={`${windowGroupId}-heading`}>{view.availabilityHeading}</h2>
        </div>
        <span className={`viewing-state viewing-state-${state.kind}`}>
          {state.kind.replaceAll("_", " ")}
        </span>
      </div>

      {demoMode ? (
        <p className="demo-calendar-disclosure">
          <strong>Simulated Calendar.</strong> Demo Calendar fixture—no Google account or API is
          being used.
        </p>
      ) : null}

      <p>{view.availabilityDetail}</p>
      <p className="side-effect-disclosure">
        <strong>{view.sideEffectDisclosure}.</strong> Holds are private and tentative; notifications
        are off.
      </p>

      {state.kind === "idle" ? (
        <button className="primary-button" type="button" onClick={propose}>
          Suggest three viewing times
        </button>
      ) : null}

      {view.windows.length > 0 && activeViewingId !== null ? (
        <>
          <fieldset
            className="viewing-window-group"
            ref={windowGroupRef}
            tabIndex={-1}
            aria-describedby={`${windowGroupId}-provenance`}
          >
            <legend>{view.windowGroupLabel}</legend>
            {view.windows.map((window) => {
              const labels = formatViewingWindow(window);
              const key = windowKey(window);
              return (
                <label className="viewing-window-option" key={key}>
                  <input
                    type="radio"
                    name={`${windowGroupId}-window`}
                    value={key}
                    checked={selectedWindowKey === key}
                    disabled={pending}
                    onChange={() => setSelectedWindowKey(key)}
                  />
                  <span>
                    <strong>{labels.date}</strong>
                    <span>{labels.time}</span>
                    <small>{formatViewingCheckedAt(window, demoMode)}</small>
                    {window.requiresConflictWarning ? (
                      <em>Calendar conflicts not checked</em>
                    ) : (
                      <em>
                        {demoMode
                          ? "Simulated primary Calendar checked"
                          : "Primary Google Calendar checked"}
                      </em>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="viewing-provenance" id={`${windowGroupId}-provenance`}>
            Rules applied: {String(view.windows[0]?.rules.durationMinutes)} minute viewing,{" "}
            {String(view.windows[0]?.rules.minimumNoticeMinutes)} minute minimum notice,{" "}
            {String(view.windows[0]?.rules.travelMinutes)} minute travel, and{" "}
            {String(view.windows[0]?.rules.bufferMinutes)} minute buffer.
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={pending || selectedWindow === null}
            onClick={() => {
              if (selectedWindow !== null) selectAndPreview(activeViewingId, selectedWindow);
            }}
          >
            {selectedWindow?.requiresConflictWarning
              ? "Review time with conflict warning"
              : "Review this tentative hold"}
          </button>
        </>
      ) : null}

      {view.previewDetails === null ? null : (
        <div className="calendar-hold-preview" aria-label="Exact tentative hold preview">
          <dl>
            <div>
              <dt>Title</dt>
              <dd>{view.previewDetails.title}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{view.previewDetails.time}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{view.previewDetails.timeZone}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>{view.previewDetails.address}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd className="preview-notes">{view.previewDetails.notes}</dd>
            </div>
            <div>
              <dt>Reminders</dt>
              <dd>{view.previewDetails.reminders}</dd>
            </div>
            <div>
              <dt>Notifications</dt>
              <dd>{view.previewDetails.notifications}</dd>
            </div>
          </dl>
          {view.preview?.warning === null ? null : (
            <p className="viewing-warning" role="alert">
              {view.preview?.warning}
            </p>
          )}
          {state.kind === "preview" ? (
            <button
              className="primary-button"
              type="button"
              disabled={pending}
              onClick={() => {
                if (approvalIntent(holdCapabilityState, demoMode) === "calendar_hold_creation") {
                  authorize("calendar_hold_creation");
                } else {
                  approveAndCreate(state.preview);
                }
              }}
            >
              {approvalIntent(holdCapabilityState, demoMode) === "calendar_hold_creation"
                ? "Enable private holds to approve and create"
                : "Approve and create private tentative hold"}
            </button>
          ) : null}
        </div>
      )}

      {visibleRecoveryOptions.length === 0 ? null : (
        <div className="viewing-recovery-actions" aria-label="Viewing planner recovery actions">
          {visibleRecoveryOptions.map((option) => (
            <button
              className={
                option.action === "continue_with_warning" ? "warning-button" : "secondary-button"
              }
              type="button"
              key={option.action}
              disabled={pending}
              onClick={() => handleRecovery(option.action)}
            >
              {option.action === "continue_with_warning"
                ? "Approve and create without a completed final conflict check"
                : option.label}
            </button>
          ))}
        </div>
      )}

      {state.kind === "created" ? (
        <div className="viewing-created-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => reschedule(state.hold.viewingId)}
          >
            Reschedule in Vera
          </button>
          <button
            className="text-button danger-text-button"
            type="button"
            disabled={pending}
            onClick={() => cancel(state.hold.viewingId)}
          >
            Cancel in Vera
          </button>
        </div>
      ) : null}

      {view.externalCleanupWarning === null ? null : (
        <p className="viewing-warning" role="alert">
          {view.externalCleanupWarning}
        </p>
      )}

      <p
        className="sr-only"
        role={view.liveRegionRole}
        aria-live={view.ariaLive}
        aria-atomic={view.ariaAtomic}
      >
        {view.liveRegionMessage}
      </p>
    </section>
  );
}
