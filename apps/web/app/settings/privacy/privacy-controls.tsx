"use client";

import { useState } from "react";

import {
  PRIVACY_DELETION_CONFIRMATION,
  PrivacyDeletionChallengeResponseSchema,
  PrivacyDeletionResponseSchema
} from "@vera/domain";

import { formatUtcDateTime } from "../../../lib/display-time.ts";
import { clearBrowserConnection } from "../integrations/browser-agent/browser-enrollment-client.ts";
import { privacyControlsView, type PrivacyControlsPhase } from "./privacy-controls-view.ts";

function errorMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("message" in payload)) {
    return "Vera could not complete that privacy request. Try again.";
  }
  const message = (payload as { readonly message?: unknown }).message;
  return typeof message === "string" && message.length > 0
    ? message
    : "Vera could not complete that privacy request. Try again.";
}

export function PrivacyControls() {
  const [phase, setPhase] = useState<PrivacyControlsPhase>("idle");
  const [challengeToken, setChallengeToken] = useState("");
  const [challengeExpiresAt, setChallengeExpiresAt] = useState<string | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const view = privacyControlsView({
    phase,
    typedConfirmation,
    hasChallenge: challengeToken.length > 0
  });

  async function requestDeletionChallenge(): Promise<void> {
    setError(null);
    setChallengeToken("");
    setChallengeExpiresAt(null);
    setTypedConfirmation("");
    setPhase("requesting_challenge");
    try {
      const response = await fetch("/api/settings/privacy/deletion-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "request_account_deletion" })
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      const challenge = PrivacyDeletionChallengeResponseSchema.parse(payload);
      setChallengeToken(challenge.challengeToken);
      setChallengeExpiresAt(challenge.expiresAt);
      setPhase("confirm");
    } catch (requestError: unknown) {
      setChallengeToken("");
      setChallengeExpiresAt(null);
      setPhase("error");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Vera could not start account deletion. Try again."
      );
    }
  }

  async function deleteAccount(): Promise<void> {
    if (view.deleteDisabled || challengeToken.length === 0) return;
    setError(null);
    setPhase("deleting");
    try {
      const response = await fetch("/api/settings/privacy/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeToken,
          confirmation: PRIVACY_DELETION_CONFIRMATION
        })
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      PrivacyDeletionResponseSchema.parse(payload);
      try {
        clearBrowserConnection();
      } catch {
        // Server-side browser authorization is already revoked; local cleanup remains best-effort.
      }
      setChallengeToken("");
      setChallengeExpiresAt(null);
      setTypedConfirmation("");
      setPhase("deleted");
      window.location.replace("/sign-in?deleted=1");
    } catch (deletionError: unknown) {
      setPhase("error");
      setError(
        deletionError instanceof Error
          ? deletionError.message
          : "Vera could not delete this account. Try again."
      );
    }
  }

  return (
    <div className="privacy-card-grid">
      <section className="integration-card privacy-card" aria-labelledby="privacy-export-heading">
        <p className="eyebrow">Portable copy</p>
        <h2 id="privacy-export-heading">Export your Vera data</h2>
        <p>
          Download a machine-readable NDJSON copy of your account, searches, listings, provenance,
          decisions, and activity. Passwords, session cookies, OAuth tokens, and browser credentials
          are excluded.
        </p>
        {view.exportDisabled ? (
          <span className="secondary-button compact-button" aria-disabled="true">
            Export unavailable while deleting
          </span>
        ) : (
          <a className="secondary-button compact-button" href="/api/settings/privacy/export">
            Export my data
          </a>
        )}
      </section>

      <section
        className="integration-card privacy-card privacy-danger-card"
        aria-labelledby="privacy-delete-heading"
      >
        <p className="eyebrow">Permanent account deletion</p>
        <h2 id="privacy-delete-heading">Delete your Vera account</h2>
        <p>
          Vera removes your account, listing and activity data, removes its stored Google credential
          after attempting provider revocation, and revokes server-side Browser Connector access.
          Managed backups age out under Vera&apos;s verified retention schedule rather than
          disappearing instantaneously.
        </p>
        <p className="privacy-local-note">
          Vera also asks this browser to clear its saved connector credential. That local step is
          best-effort; if this browser cannot complete it, remove the saved connection from the
          extension manually.
        </p>

        {!view.confirmDeletionVisible ? (
          <button
            className="danger-button privacy-delete-start"
            type="button"
            disabled={view.requestDeletionDisabled}
            onClick={() => void requestDeletionChallenge()}
          >
            {phase === "requesting_challenge"
              ? "Preparing confirmation…"
              : "Start account deletion"}
          </button>
        ) : null}

        {view.confirmDeletionVisible ? (
          <div className="privacy-confirmation">
            <p>
              Type <strong>{PRIVACY_DELETION_CONFIRMATION}</strong> exactly. This one-time
              confirmation expires in 15 minutes
              {challengeExpiresAt ? ` (at ${formatUtcDateTime(challengeExpiresAt)})` : ""}.
            </p>
            <label className="settings-field" htmlFor="privacy-delete-confirmation">
              Confirmation phrase
              <input
                id="privacy-delete-confirmation"
                value={typedConfirmation}
                autoComplete="off"
                spellCheck={false}
                disabled={phase === "deleting"}
                onChange={(event) => setTypedConfirmation(event.target.value)}
              />
            </label>
            <button
              className="danger-button privacy-delete-confirm"
              type="button"
              disabled={view.deleteDisabled}
              onClick={() => void deleteAccount()}
            >
              {phase === "deleting" ? "Deleting account…" : "Permanently delete my account"}
            </button>
          </div>
        ) : null}

        {phase === "error" && challengeToken.length === 0 ? (
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => void requestDeletionChallenge()}
          >
            Try again
          </button>
        ) : null}
        <p
          className={error ? "settings-error" : "settings-status"}
          role="status"
          aria-live="polite"
        >
          {error ?? (phase === "deleted" ? "Account deleted. Signing you out…" : "")}
        </p>
      </section>
    </div>
  );
}
