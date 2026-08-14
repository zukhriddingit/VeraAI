"use client";

import { useState } from "react";

import { BETA_CONSENT_VERSION } from "@vera/domain";

import styles from "./beta-access.module.css";

type SubmissionState = "idle" | "submitting" | "accepted" | "error";

export function BetaAccessForm() {
  const [state, setState] = useState<SubmissionState>("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/beta-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        consent: form.get("consent") === "on",
        consentVersion: BETA_CONSENT_VERSION,
        website: form.get("website")
      })
    }).catch(() => null);

    setState(response?.status === 202 ? "accepted" : "error");
  }

  if (state === "accepted") {
    return (
      <div className={styles.success} role="status">
        <strong>Request received.</strong>
        <p>We&apos;ll contact approved testers with next steps.</p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        Email address
        <input
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={320}
          required
        />
      </label>
      <label className={styles.consent}>
        <input name="consent" type="checkbox" required />
        <span>
          Vera may contact me about private-beta access. I have read the{" "}
          <a href="https://verahousing.app/privacy">privacy notice</a>.
        </span>
      </label>
      <label className={styles.honeypot} aria-hidden="true">
        Website
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
      </label>
      <button type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? "Submitting request..." : "Request private-beta access"}
      </button>
      {state === "error" ? (
        <p className={styles.error} role="alert">
          We could not save the request. Please wait a moment and try again.
        </p>
      ) : null}
    </form>
  );
}
