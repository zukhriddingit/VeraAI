"use client";

import {
  CaptureErrorResponseSchema,
  CaptureStatusResponseSchema,
  type CaptureFieldSummary,
  type CaptureStatusResponse
} from "@vera/domain";
import { useEffect, useState } from "react";

const pollIntervalMilliseconds = 500;

function titleForField(fieldPath: string): string {
  const spaced = fieldPath
    .replaceAll(".", " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase();
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function labelForMode(mode: "deterministic_only" | "llm_augmented"): string {
  return mode === "deterministic_only" ? "Deterministic only" : "LLM augmented";
}

function labelForMethod(method: CaptureFieldSummary["extractionMethod"]): string {
  switch (method) {
    case "fixture_structured":
      return "Fixture structured";
    case "manual":
      return "Manual structured";
    case "rule":
      return "Deterministic rule";
    case "ai":
      return "Validated AI";
  }
}

function confidenceLabel(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)}%`;
}

function CaptureFieldEvidence({ field }: { readonly field: CaptureFieldSummary }) {
  const statusLabel = field.status === "known" ? "Known" : "Unknown";

  return (
    <li className="evidence-field">
      <div className="evidence-field-heading">
        <div>
          <h3>{titleForField(field.fieldPath)}</h3>
          <code>{field.fieldPath}</code>
        </div>
        <span
          className={`evidence-field-status evidence-field-status-${field.status}`}
          aria-label={`Field status: ${statusLabel}`}
        >
          {statusLabel}
        </span>
      </div>
      <dl>
        <div className="evidence-value-row">
          <dt>Value</dt>
          <dd>
            {field.status === "known" ? (
              <span className="inert-evidence-value">{field.displayValue}</span>
            ) : (
              <span>Unknown — {field.unknownReason?.replaceAll("_", " ")}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>
            <span className={`evidence-method evidence-method-${field.extractionMethod}`}>
              {labelForMethod(field.extractionMethod)}
            </span>
          </dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{confidenceLabel(field.confidenceBasisPoints)}</dd>
        </div>
        <div className="evidence-wide-row">
          <dt>Quoted evidence</dt>
          <dd className="evidence-snippet">
            {field.evidenceSnippet ?? "No quoted evidence is recorded for this field."}
          </dd>
        </div>
        <div className="evidence-wide-row">
          <dt>Explanation</dt>
          <dd>{field.explanation}</dd>
        </div>
      </dl>
    </li>
  );
}

function CaptureRun({ detail }: { readonly detail: CaptureStatusResponse }) {
  const run = detail.extractionRun;

  return (
    <section className="evidence-run" aria-labelledby="extraction-run-heading">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Normalization record</p>
          <h2 id="extraction-run-heading">Extraction run</h2>
        </div>
        <span className={`normalization-state normalization-state-${detail.normalizationState}`}>
          {detail.normalizationState.replaceAll("_", " ")}
        </span>
      </div>
      {run === null ? (
        <p className="evidence-waiting">
          {detail.normalizationState === "completed"
            ? "This normalized record does not have extraction-run metadata. Available field provenance is shown below."
            : "Normalized field evidence is not available yet. Vera will keep this page current while the local job is queued or processing."}
        </p>
      ) : (
        <dl className="run-metadata">
          <div>
            <dt>Mode</dt>
            <dd>{labelForMode(run.mode)}</dd>
          </div>
          {run.providerId === null ? null : (
            <div>
              <dt>Provider</dt>
              <dd>{run.providerId}</dd>
            </div>
          )}
          {run.model === null ? null : (
            <div>
              <dt>Model</dt>
              <dd>{run.model}</dd>
            </div>
          )}
          <div>
            <dt>Prompt version</dt>
            <dd>{run.promptVersion}</dd>
          </div>
          <div>
            <dt>Extraction version</dt>
            <dd>{run.extractionVersion}</dd>
          </div>
          <div>
            <dt>Requested fields</dt>
            <dd>{run.requestedFields.length === 0 ? "None" : run.requestedFields.join(", ")}</dd>
          </div>
          <div>
            <dt>Token usage</dt>
            <dd>{run.usage.totalTokens}</dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>{run.latencyMilliseconds} ms</dd>
          </div>
          <div>
            <dt>Repair attempts</dt>
            <dd>{run.repairCount}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

export function CaptureEvidence({ rawListingId }: { readonly rawListingId: string }) {
  const [detail, setDetail] = useState<CaptureStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/captures/${encodeURIComponent(rawListingId)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const safeError = CaptureErrorResponseSchema.parse(body);
          setError(safeError.message);
          return;
        }

        const nextDetail = CaptureStatusResponseSchema.parse(body);
        setDetail(nextDetail);
        setError(null);
        if (["queued", "leased", "retryable"].includes(nextDetail.normalizationState)) {
          timer = setTimeout(() => void load(), pollIntervalMilliseconds);
        }
      } catch (loadError: unknown) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError("Local extraction evidence is unavailable.");
      }
    }

    void load();
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [rawListingId]);

  if (error !== null) {
    return (
      <section className="evidence-message evidence-message-error" role="alert">
        <p className="eyebrow">Evidence unavailable</p>
        <h2>This capture needs attention.</h2>
        <p>{error}</p>
      </section>
    );
  }

  if (detail === null) {
    return (
      <section className="evidence-message" aria-live="polite" aria-busy="true">
        <p>Loading local extraction evidence…</p>
      </section>
    );
  }

  return (
    <div className="evidence-detail" aria-live="polite">
      <CaptureRun detail={detail} />
      {detail.fields.length === 0 ? null : (
        <section className="evidence-fields" aria-labelledby="field-evidence-heading">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Field-level provenance</p>
              <h2 id="field-evidence-heading">Field evidence</h2>
            </div>
            <p>{detail.fields.length} recorded fields</p>
          </div>
          <ol className="evidence-field-list">
            {detail.fields.map((field) => (
              <CaptureFieldEvidence key={field.fieldPath} field={field} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
