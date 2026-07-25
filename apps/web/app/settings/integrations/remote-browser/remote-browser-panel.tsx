"use client";

import {
  RemoteExtensionSnapshotResponseSchema,
  type RemoteExtensionSnapshotResponse
} from "@vera/domain";
import { useState } from "react";

const confirmationLabels = [
  "Exactly one intended tab is in the OpenClaw tab group.",
  "I approve one read-only snapshot of that shared tab.",
  "I understand Vera cannot interact with the page in this spike.",
  "I understand this proves connectivity only, not listing discovery."
] as const;

export function RemoteBrowserPanel({ available }: { readonly available: boolean }) {
  const [confirmations, setConfirmations] = useState([false, false, false, false]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RemoteExtensionSnapshotResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const allConfirmed = confirmations.every(Boolean);

  async function requestSnapshot(): Promise<void> {
    if (!available || !allConfirmed) return;
    setPending(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await fetch("/api/integrations/remote-browser/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sharedExactlyOneTab: true,
          approvesReadOnlySnapshot: true,
          understandsNoBrowserInteraction: true,
          understandsConnectivitySpikeOnly: true
        })
      });
      const body = (await response.json()) as unknown;
      const parsed = RemoteExtensionSnapshotResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        const failure = body as { code?: unknown };
        throw new Error(
          typeof failure.code === "string"
            ? `Snapshot stopped safely: ${failure.code.replaceAll("_", " ")}.`
            : "Snapshot stopped safely."
        );
      }
      setResult(parsed.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Snapshot stopped safely.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      className="settings-section browser-agent-section"
      aria-labelledby="remote-browser-heading"
    >
      <div className="settings-account-card">
        <div>
          <p className="eyebrow">Direct WSS · no local agent</p>
          <h2 id="remote-browser-heading">OpenClaw consent tab</h2>
          <p>
            Only tabs you place in the OpenClaw group are shared. Remove the tab from the group to
            revoke access immediately.
          </p>
        </div>
        <span
          className={`integration-health integration-health-${available ? "connected" : "offline"}`}
        >
          {available ? "Configured for founder" : "Disabled or not configured"}
        </span>
      </div>

      <article className="integration-card browser-capture-card">
        <p className="eyebrow">One request · no browser actions</p>
        <h3>Read the shared tab</h3>
        {confirmationLabels.map((label, index) => (
          <label className="browser-confirmation" key={label}>
            <input
              type="checkbox"
              checked={confirmations[index] ?? false}
              onChange={(event) =>
                setConfirmations((current) =>
                  current.map((value, itemIndex) =>
                    itemIndex === index ? event.target.checked : value
                  )
                )
              }
            />
            {label}
          </label>
        ))}
        <button
          className="primary-button"
          type="button"
          disabled={!available || !allConfirmed || pending}
          onClick={() => void requestSnapshot()}
        >
          {pending ? "Reading shared tab…" : "Request read-only snapshot"}
        </button>
      </article>

      {message ? (
        <div className="settings-error" role="status">
          <span>{message}</span>
        </div>
      ) : null}

      {result ? (
        <article className="integration-card browser-job-card" aria-live="polite">
          <p className="eyebrow">Minimized snapshot · {result.snapshot.schemaVersion}</p>
          <h3>{result.snapshot.page.title}</h3>
          <p>{result.snapshot.page.url}</p>
          <ul>
            {result.snapshot.textLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            Captured {new Date(result.snapshot.capturedAt).toLocaleString()} · content hash{" "}
            {result.snapshot.contentSha256.slice(0, 12)}…
          </p>
        </article>
      ) : null}
    </section>
  );
}
