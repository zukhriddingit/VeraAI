"use client";

import { GmailAuthorizationResponseSchema, type GmailIntegrationStatus } from "@vera/domain";
import { useState } from "react";

const labels = {
  granted: "Connected",
  missing: "Permission missing",
  expired: "Expired",
  revoked: "Reconnect required",
  disconnected: "Not connected",
  unconfigured: "Unavailable"
} as const;

export function GmailIntegrationCard({
  initialStatus
}: {
  readonly initialStatus: GmailIntegrationStatus;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/google/gmail/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: "/settings/integrations" })
      });
      const body = (await response.json()) as unknown;
      const parsed = GmailAuthorizationResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) throw new Error("Gmail authorization could not start.");
      window.location.assign(parsed.data.authorizationUrl);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Gmail authorization could not start.");
      setPending(false);
    }
  }

  const canConnect = !["granted", "unconfigured"].includes(initialStatus.state);
  return (
    <section className="settings-section" aria-labelledby="gmail-alert-heading">
      <article className="integration-card">
        <div className="integration-card-heading">
          <div>
            <p className="eyebrow">Google · Incremental permission</p>
            <h2 id="gmail-alert-heading">Gmail listing-alert ingestion</h2>
          </div>
          <span className={`capability-state capability-state-${initialStatus.state}`}>
            {labels[initialStatus.state]}
          </span>
        </div>
        <p>
          Vera reads only messages matching the dedicated Vera label or configured listing-alert
          senders and subjects. It stores the message ID and minimal listing evidence—not your full
          mailbox message.
        </p>
        <p className="integration-disclosure">
          Permission: <code>gmail.readonly</code>. Vera cannot modify mail, send mail, or use Gmail
          as a notification channel.
        </p>
        {initialStatus.accountEmail ? <p>Connected account: {initialStatus.accountEmail}</p> : null}
        {initialStatus.state === "granted" ? (
          <p className="integration-last-used">
            Scheduled ingestion:{" "}
            {initialStatus.scheduledIngestionEnabled ? "enabled" : "disabled by operator policy"}
          </p>
        ) : null}
        {canConnect ? (
          <button
            className="primary-button compact-button"
            type="button"
            disabled={pending}
            onClick={() => void connect()}
          >
            {pending
              ? "Opening Google…"
              : initialStatus.state === "disconnected" || initialStatus.state === "missing"
                ? "Enable Gmail alerts"
                : "Reconnect Gmail"}
          </button>
        ) : null}
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>
    </section>
  );
}
