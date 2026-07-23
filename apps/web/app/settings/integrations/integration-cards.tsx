"use client";

import {
  CalendarCapabilityAuthorizationResponseSchema,
  type CalendarCapability,
  type CalendarCapabilityGrantState,
  type CalendarCapabilityStatus,
  type CalendarIntegrationStatusResponse
} from "@vera/domain";
import { useState } from "react";

import {
  interpretGoogleDisconnectResponse,
  presentGoogleIntegrationAccount
} from "./integration-cards-view.ts";

interface IntegrationCardsProps {
  readonly initialStatus: CalendarIntegrationStatusResponse;
}

interface CapabilityDefinition {
  readonly status: CalendarCapabilityStatus;
  readonly title: string;
  readonly description: string;
  readonly disclosure: string;
}

const stateLabels: Record<CalendarCapabilityGrantState, string> = {
  granted: "Granted",
  missing: "Not granted",
  expired: "Expired",
  revoked: "Revoked",
  disconnected: "Not connected",
  unconfigured: "Unavailable"
};

function actionLabel(state: CalendarCapabilityGrantState, title: string): string | null {
  if (state === "granted") return null;
  if (state === "unconfigured") return null;
  if (state === "expired" || state === "revoked") return "Reconnect Google";
  if (state === "disconnected") return "Connect Google";
  return `Enable ${title.toLowerCase()}`;
}

function safeErrorMessage(value: unknown): string {
  if (typeof value !== "object" || value === null) return "Google authorization could not start.";
  const message = Reflect.get(value, "message");
  return typeof message === "string" && message.length <= 500
    ? message
    : "Google authorization could not start.";
}

export function IntegrationCards({ initialStatus }: IntegrationCardsProps) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<CalendarCapability | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const definitions: readonly CapabilityDefinition[] = [
    {
      status: status.conflictChecking,
      title: "Calendar conflict checking",
      description:
        "Vera reads free/busy blocks only to remove viewing times that overlap your schedule.",
      disclosure:
        "Checks only the connected account’s primary Google Calendar. Event titles, descriptions, people, and locations are not read."
    },
    {
      status: status.holdCreation,
      title: "Private viewing holds",
      description:
        "Vera may create a private tentative event only after you approve the exact hold preview.",
      disclosure:
        "This permission is separate from conflict checking. Enabling it does not create an event."
    }
  ];
  const account = presentGoogleIntegrationAccount(status);

  async function authorize(capability: CalendarCapability): Promise<void> {
    setPending(capability);
    setError(null);
    try {
      const response = await fetch("/api/integrations/google/calendar/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability, returnTo: "/settings/integrations" })
      });
      const body = (await response.json()) as unknown;
      const parsed = CalendarCapabilityAuthorizationResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) throw new Error(safeErrorMessage(body));
      window.location.assign(parsed.data.authorizationUrl);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Google authorization could not start.");
      setPending(null);
    }
  }

  async function disconnect(): Promise<void> {
    setPending("disconnect");
    setError(null);
    try {
      const response = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      let body: unknown = null;
      try {
        body = (await response.json()) as unknown;
      } catch {
        // A malformed response is handled as a closed disconnect failure below.
      }
      const outcome = interpretGoogleDisconnectResponse(response.status, body);
      if (!outcome.disconnected) {
        throw new Error(outcome.error ?? "Google Calendar could not be disconnected.");
      }
      setStatus({
        ...status,
        conflictChecking: {
          ...status.conflictChecking,
          state: "disconnected",
          accountEmail: null,
          lastSuccessfulUseAt: null
        },
        holdCreation: {
          ...status.holdCreation,
          state: "disconnected",
          accountEmail: null,
          lastSuccessfulUseAt: null
        }
      });
      setError(outcome.warning);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Google Calendar could not disconnect.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="google-calendar-heading">
      <div className="settings-account-card">
        <div>
          <p className="eyebrow">Google account</p>
          <h2 id="google-calendar-heading">Google Calendar</h2>
          <p>{account.accountDescription}</p>
        </div>
        <span
          className={`integration-health integration-health-${account.capabilityAvailable ? "connected" : "offline"}`}
        >
          {account.healthLabel}
        </span>
      </div>

      {error === null ? null : (
        <div className="settings-error" role="alert">
          <strong>Calendar connection needs attention.</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="integration-card-grid">
        {definitions.map((definition) => {
          const label = actionLabel(definition.status.state, definition.title);
          return (
            <article className="integration-card" key={definition.status.capability}>
              <div className="integration-card-heading">
                <div>
                  <p className="eyebrow">Incremental permission</p>
                  <h3>{definition.title}</h3>
                </div>
                <span className={`capability-state capability-state-${definition.status.state}`}>
                  {stateLabels[definition.status.state]}
                </span>
              </div>
              <p>{definition.description}</p>
              <p className="integration-disclosure">{definition.disclosure}</p>
              {definition.status.lastSuccessfulUseAt === null ? null : (
                <p className="integration-last-used">
                  Last successful use:{" "}
                  {new Date(definition.status.lastSuccessfulUseAt).toLocaleString()}
                </p>
              )}
              {label === null ? null : (
                <button
                  className="primary-button compact-button"
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void authorize(definition.status.capability)}
                >
                  {pending === definition.status.capability ? "Opening Google…" : label}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <aside className="primary-calendar-note" aria-label="Calendar coverage">
        <strong>Primary Calendar only</strong>
        <p>
          Founder release conflict checks use only the connected account’s primary Google Calendar.
          Vera never claims that other calendars were checked.
        </p>
      </aside>

      {account.showDisconnect ? (
        <button
          className="secondary-button settings-disconnect"
          type="button"
          disabled={pending !== null}
          onClick={() => void disconnect()}
        >
          {pending === "disconnect" ? "Disconnecting…" : "Disconnect Google Calendar"}
        </button>
      ) : null}
    </section>
  );
}
