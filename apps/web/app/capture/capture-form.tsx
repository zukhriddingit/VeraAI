"use client";

import {
  CaptureAcceptedResponseSchema,
  CaptureErrorResponseSchema,
  CaptureStatusResponseSchema,
  type CaptureFieldSummary,
  type CaptureStatusResponse
} from "@vera/domain";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type CaptureMode = "manual_text" | "manual_structured";

type SubmissionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "tracking"; rawListingId: string; duplicate: boolean }
  | { kind: "complete"; result: CaptureStatusResponse }
  | { kind: "error"; message: string };

const pollIntervalMilliseconds = 500;
const maximumPolls = 120;

function FieldResult({ field }: { field: CaptureFieldSummary }) {
  return (
    <li>
      <span>{field.fieldPath}</span>
      <strong>{field.status === "known" ? field.displayValue : "Unknown"}</strong>
      {field.unknownReason === null ? null : (
        <small>{field.unknownReason.replaceAll("_", " ")}</small>
      )}
    </li>
  );
}

export function CaptureForm() {
  const [mode, setMode] = useState<CaptureMode>("manual_text");
  const [sourceUrl, setSourceUrl] = useState("");
  const [listingText, setListingText] = useState("");
  const [structuredJson, setStructuredJson] = useState(`{
  "source": "other",
  "title": "Synthetic user-supplied listing",
  "monthlyRentCents": 245000,
  "bedrooms": 1,
  "bathrooms": 1,
  "addressText": "101 Example Way, Harbor City, MA",
  "sourcePostedAt": "2026-07-17T12:00:00.000Z",
  "contactChannel": "platform_message"
}`);
  const [submission, setSubmission] = useState<SubmissionState>({ kind: "idle" });
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => activeRequest.current?.abort();
  }, []);

  async function trackCapture(rawListingId: string, duplicate: boolean): Promise<void> {
    let polls = 0;

    while (polls < maximumPolls) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMilliseconds));
      const controller = activeRequest.current;

      if (!controller || controller.signal.aborted) {
        return;
      }

      const response = await fetch(`/api/captures/${encodeURIComponent(rawListingId)}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        const error = CaptureErrorResponseSchema.parse(body);
        throw new Error(error.message);
      }

      const status = CaptureStatusResponseSchema.parse(body);

      if (
        status.state === "completed" ||
        status.state === "duplicate_resolved" ||
        status.state === "failed"
      ) {
        setSubmission(
          status.state === "failed"
            ? { kind: "error", message: "Normalization could not be completed." }
            : { kind: "complete", result: { ...status, duplicate } }
        );
        return;
      }

      polls += 1;
    }

    throw new Error("Normalization is still queued. The worker may be offline.");
  }

  async function submitCapture(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSubmission({ kind: "submitting" });

    try {
      let payload: unknown;

      if (mode === "manual_text") {
        payload = { kind: mode, sourceUrl, listingText };
      } else {
        let listing: unknown;

        try {
          listing = JSON.parse(structuredJson) as unknown;
        } catch {
          throw new Error("Structured listing JSON is not valid JSON.");
        }

        payload = {
          kind: mode,
          ...(sourceUrl.trim() === "" ? {} : { sourceUrl }),
          listing
        };
      }

      const response = await fetch("/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        const error = CaptureErrorResponseSchema.parse(body);
        throw new Error(error.message);
      }

      const accepted = CaptureAcceptedResponseSchema.parse(body);
      setSubmission({
        kind: "tracking",
        rawListingId: accepted.rawListingId,
        duplicate: accepted.duplicate
      });
      await trackCapture(accepted.rawListingId, accepted.duplicate);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setSubmission({
        kind: "error",
        message: error instanceof Error ? error.message : "Capture could not be completed."
      });
    }
  }

  const busy = submission.kind === "submitting" || submission.kind === "tracking";

  return (
    <div className="capture-layout">
      <form className="capture-form" onSubmit={(event) => void submitCapture(event)}>
        <fieldset className="capture-mode-selector">
          <legend>Capture format</legend>
          <label>
            <input
              type="radio"
              name="capture-mode"
              value="manual_text"
              checked={mode === "manual_text"}
              onChange={() => setMode("manual_text")}
            />
            URL and pasted text
          </label>
          <label>
            <input
              type="radio"
              name="capture-mode"
              value="manual_structured"
              checked={mode === "manual_structured"}
              onChange={() => setMode("manual_structured")}
            />
            Structured JSON
          </label>
        </fieldset>

        <label className="capture-field">
          <span>Listing URL {mode === "manual_structured" ? "(optional)" : ""}</span>
          <input
            type="url"
            value={sourceUrl}
            required={mode === "manual_text"}
            maxLength={2048}
            placeholder="https://housing.example/listing/123"
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <small>Vera stores this as provenance. It does not open or fetch the URL.</small>
        </label>

        {mode === "manual_text" ? (
          <label className="capture-field">
            <span>Pasted listing text</span>
            <textarea
              value={listingText}
              required
              minLength={1}
              maxLength={250_000}
              rows={12}
              placeholder={
                "Base rent: USD 2450 per month\n1 bed · 1 bath\nAddress: 101 Example Way\nPosted: 2026-07-17"
              }
              onChange={(event) => setListingText(event.target.value)}
            />
          </label>
        ) : (
          <label className="capture-field">
            <span>Structured listing JSON</span>
            <textarea
              value={structuredJson}
              required
              minLength={2}
              maxLength={250_000}
              rows={16}
              spellCheck={false}
              onChange={(event) => setStructuredJson(event.target.value)}
            />
          </label>
        )}

        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Capturing…" : "Capture supplied evidence"}
        </button>
      </form>

      <aside className="capture-result" aria-live="polite" aria-busy={busy}>
        {submission.kind === "idle" ? (
          <>
            <p className="eyebrow">Local-only pipeline</p>
            <h2>What happens next</h2>
            <ol>
              <li>The request is validated and checked against source policy.</li>
              <li>Your supplied evidence is stored as an immutable snapshot.</li>
              <li>The local worker extracts only deterministic, explicit facts.</li>
            </ol>
          </>
        ) : null}
        {submission.kind === "submitting" ? <p>Validating and storing supplied evidence…</p> : null}
        {submission.kind === "tracking" ? (
          <p>
            {submission.duplicate ? "Existing evidence found. " : "Evidence captured. "}
            Waiting for local normalization…
          </p>
        ) : null}
        {submission.kind === "error" ? (
          <div className="capture-error" role="alert">
            <strong>Capture needs attention.</strong>
            <span>{submission.message}</span>
          </div>
        ) : null}
        {submission.kind === "complete" ? (
          <div>
            <p className="eyebrow">Normalization complete</p>
            <h2>
              {submission.result.duplicate ? "Existing evidence reused" : "Evidence captured"}
            </h2>
            <ul className="capture-fields">
              {submission.result.fields.map((field) => (
                <FieldResult key={field.fieldPath} field={field} />
              ))}
            </ul>
            <Link
              className="evidence-link"
              href={`/captures/${encodeURIComponent(submission.result.rawListingId)}`}
            >
              View extraction evidence
            </Link>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
