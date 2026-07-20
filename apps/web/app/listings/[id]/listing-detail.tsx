"use client";

import {
  CanonicalListingDetailResponseSchema,
  ShortlistResponseSchema,
  type CanonicalListingDetailResponse,
  type ListingSourceLabel
} from "@vera/domain";
import Link from "next/link";
import { useEffect, useState } from "react";

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; detail: CanonicalListingDetailResponse }
  | { kind: "error"; message: string };

const sourceNames: Record<ListingSourceLabel, string> = {
  zillow: "Zillow",
  facebook_marketplace: "Facebook Marketplace",
  craigslist: "Craigslist",
  apartments_com: "Apartments.com",
  other: "Other"
};
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});
const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function money(value: number | null): string {
  return value === null ? "Unknown" : currency.format(value / 100);
}

function address(detail: CanonicalListingDetailResponse): string {
  return [
    detail.canonical.address.line1,
    detail.canonical.address.unit,
    detail.canonical.address.city,
    detail.canonical.address.region
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}

function factorName(code: string): string {
  return code.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

async function requestListingDetail(
  listingId: string,
  signal?: AbortSignal
): Promise<CanonicalListingDetailResponse> {
  const response = await fetch(`/api/listings/${listingId}`, {
    cache: "no-store",
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error("detail unavailable");
  return CanonicalListingDetailResponseSchema.parse((await response.json()) as unknown);
}

export function ListingDetail({ listingId }: { listingId: string }) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  async function load(): Promise<void> {
    try {
      setState({
        kind: "ready",
        detail: await requestListingDetail(listingId)
      });
    } catch {
      setState({ kind: "error", message: "Listing evidence is unavailable." });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setState({
          kind: "ready",
          detail: await requestListingDetail(listingId, controller.signal)
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error", message: "Listing evidence is unavailable." });
      }
    })();
    return () => controller.abort();
  }, [listingId]);

  async function toggleShortlist() {
    if (state.kind !== "ready") return;
    const shortlisted = state.detail.canonical.lifecycleState !== "shortlisted";
    setSaving(true);
    try {
      const response = await fetch(`/api/listings/${listingId}/shortlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortlisted })
      });
      if (!response.ok) throw new Error("shortlist unavailable");
      ShortlistResponseSchema.parse((await response.json()) as unknown);
      await load();
    } catch {
      setState({ kind: "error", message: "Shortlist state could not be changed safely." });
    } finally {
      setSaving(false);
    }
  }

  if (state.kind === "loading") return <div className="listing-message">Loading evidence…</div>;
  if (state.kind === "error") {
    return <div className="listing-message listing-message-warning">{state.message}</div>;
  }

  const { detail } = state;
  const shortlisted = detail.canonical.lifecycleState === "shortlisted";
  const scoreV2 = detail.score && "schemaVersion" in detail.score ? detail.score : null;
  return (
    <div className="listing-detail-shell">
      <section className="listing-detail-summary">
        <div>
          <p className="eyebrow">{detail.summary.fitLabel?.replaceAll("_", " ") ?? "Not scored"}</p>
          <h2>{address(detail)}</h2>
          <p className="detail-title">{detail.canonical.title}</p>
        </div>
        <div className="detail-actions">
          <button
            className={`shortlist-button ${shortlisted ? "shortlist-button-active" : ""}`}
            type="button"
            disabled={saving}
            onClick={() => void toggleShortlist()}
          >
            {saving ? "Saving…" : shortlisted ? "Remove from shortlist" : "Add to shortlist"}
          </button>
          <button className="secondary-button" type="button" disabled>
            Prepare outreach — coming next
          </button>
        </div>
      </section>

      <section className="detail-fact-grid" aria-label="Canonical listing facts">
        <div>
          <span>Monthly rent</span>
          <strong>{money(detail.canonical.monthlyRentCents)}</strong>
        </div>
        <div>
          <span>Required fees</span>
          <strong>{money(detail.canonical.recurringFeesCents)}</strong>
        </div>
        <div>
          <span>Bedrooms</span>
          <strong>{detail.canonical.bedrooms ?? "Unknown"}</strong>
        </div>
        <div>
          <span>Bathrooms</span>
          <strong>{detail.canonical.bathrooms ?? "Unknown"}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{detail.canonical.availableOn ?? "Unknown"}</strong>
        </div>
        <div>
          <span>Sources retained</span>
          <strong>{detail.sources.length}</strong>
        </div>
      </section>

      <div className="detail-grid">
        <section className="detail-panel" aria-labelledby="fit-heading">
          <p className="eyebrow">Versioned deterministic score</p>
          <h2 id="fit-heading">Fit explanation</h2>
          <p className="detail-callout detail-callout-positive">
            {detail.summary.topPositiveReason}
          </p>
          <p className="detail-callout detail-callout-concern">{detail.summary.topConcern}</p>
          <div className="factor-list">
            {detail.score?.factors.map((factor) => (
              <div className="factor-row" key={factor.code}>
                <span>{factorName(factor.code)}</span>
                <strong>
                  {"valueStatus" in factor
                    ? factor.scoreBasisPoints === null
                      ? "Unknown"
                      : `${String(Math.round(factor.scoreBasisPoints / 100))}%`
                    : `${String(Math.round((factor.scoreBasisPoints + 10_000) / 200))}%`}
                </strong>
                <small>
                  {("reasonCodes" in factor
                    ? factor.reasonCodes.join(", ")
                    : factor.reasonCode
                  ).replaceAll("_", " ")}
                </small>
              </div>
            )) ?? <p>No score snapshot is available.</p>}
          </div>
          {scoreV2 ? (
            <>
              <p className="detail-callout">{scoreV2.explanation}</p>
              <div className="factor-list" aria-label="Hard constraint results">
                {scoreV2.hardConstraints.map((constraint) => (
                  <div className="factor-row" key={constraint.code}>
                    <span>{factorName(constraint.code)}</span>
                    <strong>{constraint.status}</strong>
                    <small>{constraint.reasonCode.replaceAll("_", " ")}</small>
                  </div>
                ))}
              </div>
              <p>
                Separate penalties: stale {String(scoreV2.stalePenaltyBasisPoints / 100)}%, low
                confidence {String(scoreV2.lowConfidencePenaltyBasisPoints / 100)}%, risk{" "}
                {String(scoreV2.riskPenaltyBasisPoints / 100)}%.
              </p>
            </>
          ) : null}
          <small>Version: {detail.score?.algorithmVersion ?? "not available"}</small>
        </section>

        <section className="detail-panel" aria-labelledby="risk-heading">
          <p className="eyebrow">Evidence, not a verdict</p>
          <h2 id="risk-heading">Risk indicators</h2>
          {detail.risks.length === 0 ? (
            <p>No deterministic risk indicator is open for this fixture.</p>
          ) : (
            <div className="risk-list">
              {detail.risks.map((risk) => (
                <article className={`risk-card risk-card-${risk.severity}`} key={risk.id}>
                  <span>{risk.severity} · needs verification</span>
                  <h3>{factorName(risk.code)}</h3>
                  {risk.evidence.map((evidence) => (
                    <div
                      key={`${risk.id}-${evidence.sourceRecordId}-${evidence.fieldPath ?? "record"}`}
                    >
                      <p>{evidence.summary}</p>
                      {"excerpt" in evidence ? <blockquote>{evidence.excerpt}</blockquote> : null}
                    </div>
                  ))}
                  <strong>Verify: {risk.verificationAction}</strong>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="source-evidence-section" aria-labelledby="source-evidence-heading">
        <p className="eyebrow">Duplicate-source evidence</p>
        <h2 id="source-evidence-heading">Every source stays inspectable</h2>
        {detail.duplicateExplanation ? (
          <p className="duplicate-explanation">{detail.duplicateExplanation}</p>
        ) : null}
        <div className="source-evidence-grid">
          {detail.sources.map(({ record, provenance }) => (
            <article className="source-evidence-card" key={record.id}>
              <span className="source-label">{sourceNames[record.source]}</span>
              <h3>{record.title}</h3>
              <p>
                {money(record.monthlyRentCents)} · {record.bedrooms ?? "?"} bed ·{" "}
                {record.bathrooms ?? "?"} bath
              </p>
              <small>Observed {dateTime.format(new Date(record.observedAt))}</small>
              <details>
                <summary>Field provenance ({provenance.length})</summary>
                <dl className="provenance-list">
                  {provenance.map((field) => (
                    <div key={field.id}>
                      <dt>{field.fieldPath}</dt>
                      <dd>
                        {field.extractionMethod.replaceAll("_", " ")} ·{" "}
                        {String(field.confidenceBasisPoints / 100)}% confidence
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            </article>
          ))}
        </div>
      </section>

      <section className="detail-panel activity-preview" aria-labelledby="listing-activity-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Append-only record</p>
            <h2 id="listing-activity-heading">Listing activity</h2>
          </div>
          <Link className="evidence-link" href="/activity">
            View all activity →
          </Link>
        </div>
        {detail.activity.length === 0 ? (
          <p>No listing-specific activity yet.</p>
        ) : (
          detail.activity.slice(0, 8).map((event) => (
            <div className="activity-row" key={event.id}>
              <span>{event.action}</span>
              <small>{dateTime.format(new Date(event.occurredAt))}</small>
              <p>{event.detail ?? event.outcome}</p>
            </div>
          ))
        )}
      </section>

      <div className="detail-footer-actions">
        <Link className="primary-button link-button" href="/capture">
          Capture another listing
        </Link>
        <Link className="secondary-button link-button" href="/">
          Back to listing inbox
        </Link>
      </div>
    </div>
  );
}
