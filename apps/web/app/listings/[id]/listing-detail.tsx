"use client";

import {
  CanonicalListingDetailResponseSchema,
  EnrichmentResponseSchema,
  ShortlistResponseSchema,
  isExpectedSourceUrl,
  type CalendarCapabilityGrantState,
  type CanonicalListingDetailResponse,
  type ListingDetailFields,
  type ListingDetailPhoto,
  type ListingSourceLabel
} from "@vera/domain";
import Link from "next/link";
import { useState } from "react";

import { ViewingPlanner } from "./viewing-planner.tsx";

type DetailState =
  { kind: "ready"; detail: CanonicalListingDetailResponse } | { kind: "error"; message: string };

const sourceNames: Record<ListingSourceLabel, string> = {
  rentcast: "RentCast",
  zillow: "Zillow",
  facebook_marketplace: "Facebook Marketplace",
  craigslist: "Craigslist",
  apartments_com: "Apartments.com",
  bu_off_campus: "BU Off-Campus Housing",
  custom_website: "Custom housing site",
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
  const value = [
    detail.canonical.address.line1,
    detail.canonical.address.unit,
    detail.canonical.address.city,
    detail.canonical.address.region
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  return value || "Address unknown";
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

function observed(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "Unknown" : String(value);
}

function SafePhoto({ photo, alt }: { readonly photo: ListingDetailPhoto; readonly alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="detail-photo-placeholder"
        role="img"
        aria-label={`${alt}: source image unavailable`}
      >
        <span>Source image unavailable</span>
        <small>The listing evidence remains available.</small>
      </div>
    );
  }
  return (
    // Source-hosted media is never downloaded or rehosted by Vera.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo.sourceUrl} alt={alt} onError={() => setFailed(true)} loading="lazy" />
  );
}

function sourceUrl(source: CanonicalListingDetailResponse["sources"][number]): string | null {
  const candidate = source.snapshot?.details.sourceUrl ?? source.record.sourceUrl;
  return candidate && isExpectedSourceUrl(source.record.source, candidate) ? candidate : null;
}

function bestDetails(detail: CanonicalListingDetailResponse): {
  readonly fields: ListingDetailFields | null;
  readonly source: ListingSourceLabel | null;
} {
  const best = [...detail.sources]
    .filter((entry) => entry.snapshot !== null)
    .sort(
      (left, right) =>
        (right.snapshot?.completeness.basisPoints ?? 0) -
        (left.snapshot?.completeness.basisPoints ?? 0)
    )[0];
  return {
    fields: best?.snapshot?.details ?? null,
    source: best?.record.source ?? null
  };
}

async function requestListingDetail(listingId: string): Promise<CanonicalListingDetailResponse> {
  const response = await fetch(`/api/listings/${listingId}`, { cache: "no-store" });
  if (!response.ok) throw new Error("detail unavailable");
  return CanonicalListingDetailResponseSchema.parse((await response.json()) as unknown);
}

export function ListingDetail({
  listingId,
  initialDetail,
  demoMode,
  holdCapabilityState
}: {
  listingId: string;
  initialDetail: CanonicalListingDetailResponse;
  demoMode: boolean;
  holdCapabilityState: CalendarCapabilityGrantState;
}) {
  const [state, setState] = useState<DetailState>({ kind: "ready", detail: initialDetail });
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(): Promise<void> {
    setState({ kind: "ready", detail: await requestListingDetail(listingId) });
  }

  async function toggleShortlist() {
    if (state.kind !== "ready") return;
    const shortlisted = state.detail.canonical.lifecycleState !== "shortlisted";
    setSaving(true);
    setNotice(null);
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

  async function refreshDetails() {
    setRefreshing(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/listings/${listingId}/enrichment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true })
      });
      if (!response.ok) throw new Error("enrichment unavailable");
      const result = EnrichmentResponseSchema.parse((await response.json()) as unknown);
      setNotice(
        result.queuedSourceRecordIds.length > 0
          ? "Read-only detail refresh queued. It will stop for any manual browser action."
          : result.reusedFreshSourceRecordIds.length > 0
            ? "Fresh source details are already available."
            : "No eligible shared-tab source link is available to refresh."
      );
      await load();
    } catch {
      setNotice("Details could not be queued. Existing evidence is unchanged.");
    } finally {
      setRefreshing(false);
    }
  }

  if (state.kind === "error") {
    return <div className="listing-message listing-message-warning">{state.message}</div>;
  }

  const { detail } = state;
  const shortlisted = detail.canonical.lifecycleState === "shortlisted";
  const viewingEligible = ["replied", "tour_proposed", "tour_scheduled"].includes(
    detail.canonical.lifecycleState
  );
  const best = bestDetails(detail);
  const fields = best.fields;
  const photos = [
    ...new Map(
      detail.sources
        .flatMap((source) => source.snapshot?.photos ?? [])
        .sort((left, right) => left.position - right.position)
        .map((photo) => [photo.sourceUrl, photo] as const)
    ).values()
  ];
  const recurringFees = fields?.fees.filter((fee) => fee.required && fee.cadence === "month") ?? [];
  const oneTimeFees = fields?.fees.filter((fee) => fee.cadence === "one_time") ?? [];
  const completeness = detail.summary.detailCompletenessBasisPoints;
  const selectedProvenanceIds = new Set(
    detail.fieldSources.map(({ fieldProvenanceId }) => fieldProvenanceId)
  );

  return (
    <div className="listing-detail-shell">
      <section className="listing-detail-summary">
        <div>
          <p className="eyebrow">{detail.summary.fitLabel?.replaceAll("_", " ") ?? "Not scored"}</p>
          <h2>{address(detail)}</h2>
          <p className="detail-title">{fields?.propertyName ?? detail.canonical.title}</p>
          <div className="detail-status-row">
            <span>{String(Math.round(completeness / 100))}% details complete</span>
            <span>{label(detail.summary.enrichmentState)}</span>
            {best.source ? <span>Best detail source: {sourceNames[best.source]}</span> : null}
          </div>
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
          <button
            className="secondary-button"
            type="button"
            disabled={refreshing || demoMode}
            onClick={() => void refreshDetails()}
          >
            {refreshing ? "Queueing…" : "Refresh details"}
          </button>
          {detail.summary.originalListingUrl ? (
            <a
              className="evidence-link"
              href={detail.summary.originalListingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View original listing ↗
            </a>
          ) : (
            <span className="source-link-unavailable">Original link unavailable</span>
          )}
        </div>
      </section>

      {notice ? (
        <p className="action-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section className="detail-panel detail-gallery" aria-labelledby="gallery-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Source-hosted media</p>
            <h2 id="gallery-heading">Photo gallery</h2>
          </div>
          <span>{String(photos.length)} observed</span>
        </div>
        {photos.length > 0 ? (
          <div className="detail-gallery-grid">
            {photos.map((photo, index) => (
              <SafePhoto
                key={photo.sourceUrl}
                photo={photo}
                alt={`${address(detail)} photo ${String(index + 1)}`}
              />
            ))}
          </div>
        ) : (
          <div
            className="detail-photo-placeholder"
            role="img"
            aria-label="Source image unavailable"
          >
            <span>Source image unavailable</span>
            <small>No screenshot is substituted for a listing photo.</small>
          </div>
        )}
      </section>

      <section className="detail-panel" aria-labelledby="cost-heading">
        <p className="eyebrow">Observed costs only</p>
        <h2 id="cost-heading">Price and fee breakdown</h2>
        <div className="detail-fact-grid detail-fact-grid-four">
          <div>
            <span>Base rent</span>
            <strong>{money(fields?.baseRentCents ?? detail.summary.monthlyRentCents)}</strong>
          </div>
          <div>
            <span>Estimated monthly total</span>
            <strong>{money(fields?.estimatedTotalMonthlyCostCents ?? null)}</strong>
          </div>
          <div>
            <span>Deposit</span>
            <strong>{money(fields?.depositCents ?? null)}</strong>
          </div>
          <div>
            <span>Application fee</span>
            <strong>{money(fields?.applicationFeeCents ?? null)}</strong>
          </div>
        </div>
        <div className="fee-breakdown-grid">
          <div>
            <h3>Required recurring fees</h3>
            {recurringFees.length === 0 ? (
              <p>Unknown</p>
            ) : (
              recurringFees.map((fee) => (
                <p key={`${fee.kind}-${fee.label}`}>
                  <span>{fee.label}</span>
                  <strong>
                    {money(fee.amountCents)} / {fee.cadence}
                  </strong>
                </p>
              ))
            )}
          </div>
          <div>
            <h3>Known one-time fees</h3>
            {oneTimeFees.length === 0 ? (
              <p>Unknown</p>
            ) : (
              oneTimeFees.map((fee) => (
                <p key={`${fee.kind}-${fee.label}`}>
                  <span>{fee.label}</span>
                  <strong>{money(fee.amountCents)}</strong>
                </p>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="detail-panel" aria-labelledby="availability-heading">
        <p className="eyebrow">Timing</p>
        <h2 id="availability-heading">Availability and lease</h2>
        <div className="detail-fact-grid detail-fact-grid-four">
          <div>
            <span>Available date</span>
            <strong>{observed(fields?.availableOn ?? detail.summary.availableOn)}</strong>
          </div>
          <div>
            <span>Availability</span>
            <strong>{observed(fields?.availabilityText)}</strong>
          </div>
          <div>
            <span>Lease duration</span>
            <strong>{observed(fields?.leaseDurationText)}</strong>
          </div>
          <div>
            <span>Lease term</span>
            <strong>
              {fields?.leaseTermMonths ? `${String(fields.leaseTermMonths)} months` : "Unknown"}
            </strong>
          </div>
        </div>
      </section>

      <section className="detail-panel" aria-labelledby="facts-heading">
        <p className="eyebrow">Observed property facts</p>
        <h2 id="facts-heading">Property facts</h2>
        <div className="detail-fact-grid detail-fact-grid-four">
          <div>
            <span>Bedrooms</span>
            <strong>{observed(fields?.bedrooms ?? detail.summary.bedrooms)}</strong>
          </div>
          <div>
            <span>Bathrooms</span>
            <strong>{observed(fields?.bathrooms ?? detail.summary.bathrooms)}</strong>
          </div>
          <div>
            <span>Square feet</span>
            <strong>{observed(fields?.squareFeet ?? detail.summary.squareFeet)}</strong>
          </div>
          <div>
            <span>Property type</span>
            <strong>{fields?.propertyType ? label(fields.propertyType) : "Unknown"}</strong>
          </div>
          <div>
            <span>Property manager or broker</span>
            <strong>{observed(fields?.propertyManagerName)}</strong>
          </div>
          <div>
            <span>Allowed contact channel</span>
            <strong>
              {fields?.allowedContactChannel && fields.allowedContactChannel !== "unknown"
                ? label(fields.allowedContactChannel)
                : "Unknown"}
            </strong>
          </div>
        </div>
      </section>

      <section className="detail-panel" aria-labelledby="living-heading">
        <p className="eyebrow">Policies and features</p>
        <h2 id="living-heading">Pets, parking, utilities, and amenities</h2>
        <div className="detail-living-grid">
          <div>
            <span>Pets</span>
            <strong>
              {fields?.petDetails
                ? `${label(fields.petDetails.policy.cats)} cats · ${label(fields.petDetails.policy.dogs)} dogs${
                    fields.petDetails.fees.length
                      ? ` · ${fields.petDetails.fees.map((fee) => `${money(fee.amountCents)}/${fee.cadence}`).join(", ")}`
                      : ""
                  }`
                : "Unknown"}
            </strong>
          </div>
          <div>
            <span>Parking</span>
            <strong>
              {fields?.parking
                ? `${observed(fields.parking.description ?? label(fields.parking.availability))}${
                    fields.parking.monthlyCostCents === null
                      ? ""
                      : ` · ${money(fields.parking.monthlyCostCents)}/month`
                  }`
                : "Unknown"}
            </strong>
          </div>
          <div>
            <span>Utilities included</span>
            <strong>
              {fields?.utilitiesIncluded.length ? fields.utilitiesIncluded.join(", ") : "Unknown"}
            </strong>
          </div>
          <div>
            <span>Laundry</span>
            <strong>
              {fields?.laundry && fields.laundry !== "unknown" ? label(fields.laundry) : "Unknown"}
            </strong>
          </div>
          <div>
            <span>Furnished</span>
            <strong>
              {fields?.furnishedStatus && fields.furnishedStatus !== "unknown"
                ? label(fields.furnishedStatus)
                : "Unknown"}
            </strong>
          </div>
          <div>
            <span>Amenities</span>
            <strong>{fields?.amenities.length ? fields.amenities.join(", ") : "Unknown"}</strong>
          </div>
        </div>
      </section>

      <section className="detail-panel" aria-labelledby="description-heading">
        <p className="eyebrow">Source description</p>
        <h2 id="description-heading">Description</h2>
        <p className="listing-description">
          {fields?.description ?? "No description was safely observed."}
        </p>
      </section>

      <section className="detail-panel missing-information-panel" aria-labelledby="missing-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Unknown is not false</p>
            <h2 id="missing-heading">Missing information</h2>
            <p>Important-field checklist</p>
          </div>
          <span className="missing-count">
            {String(
              fields
                ? (detail.sources.find((source) => source.snapshot?.details === fields)?.snapshot
                    ?.completeness.missingImportantFields.length ?? 0)
                : 15
            )}{" "}
            open
          </span>
        </div>
        <ul className="missing-information-list">
          {(fields
            ? (detail.sources.find((source) => source.snapshot?.details === fields)?.snapshot
                ?.completeness.missingImportantFields ?? [])
            : ["source details"]
          ).map((item) => (
            <li key={item}>
              <span aria-hidden="true">?</span>
              <div>
                <strong>{label(item)}</strong>
                <p>Verify this fact with the source or property contact.</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="source-evidence-section" aria-labelledby="source-evidence-heading">
        <p className="eyebrow">Links and field provenance</p>
        <h2 id="source-evidence-heading">Every original source stays inspectable</h2>
        {detail.duplicateExplanation ? (
          <p className="duplicate-explanation">{detail.duplicateExplanation}</p>
        ) : null}
        <div className="source-evidence-grid">
          {detail.sources.map((source) => {
            const original = sourceUrl(source);
            const provenance = [
              ...source.provenance.map((entry) => ({
                id: entry.id,
                field: entry.fieldPath,
                method: entry.extractionMethod,
                confidence: entry.confidenceBasisPoints,
                selected: selectedProvenanceIds.has(entry.id)
              })),
              ...(source.snapshot?.fieldProvenance ?? []).map((entry, index) => ({
                id: `${source.record.id}-enrichment-${String(index)}`,
                field: entry.fieldPath,
                method: entry.extractionMethod,
                confidence: entry.confidenceBasisPoints,
                selected: false
              }))
            ];
            return (
              <article className="source-evidence-card" key={source.record.id}>
                <div className="source-card-heading">
                  <span className="source-label">{sourceNames[source.record.source]}</span>
                  <span>{label(source.enrichment?.state ?? "not_requested")}</span>
                </div>
                <h3>{source.snapshot?.details.propertyName ?? source.record.title}</h3>
                <p>
                  {money(source.snapshot?.details.baseRentCents ?? source.record.monthlyRentCents)}{" "}
                  · {source.snapshot?.details.bedrooms ?? source.record.bedrooms ?? "?"} bed ·{" "}
                  {source.snapshot?.details.bathrooms ?? source.record.bathrooms ?? "?"} bath
                </p>
                <small>
                  Observed{" "}
                  {dateTime.format(
                    new Date(source.snapshot?.observedAt ?? source.record.observedAt)
                  )}
                </small>
                <small>
                  {source.snapshot?.details.sourceUpdatedAt
                    ? `Source updated ${dateTime.format(new Date(source.snapshot.details.sourceUpdatedAt))}`
                    : "Latest source update unknown"}
                </small>
                {original ? (
                  <a
                    className="evidence-link"
                    href={original}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View original listing ↗
                  </a>
                ) : (
                  <span className="source-link-unavailable">Original link unavailable</span>
                )}
                <details>
                  <summary>Field provenance ({provenance.length})</summary>
                  <dl className="provenance-list">
                    {provenance.map((entry) => (
                      <div key={entry.id}>
                        <dt>{entry.field}</dt>
                        <dd>
                          {entry.method.replaceAll("_", " ")} · {String(entry.confidence / 100)}%
                          confidence{entry.selected ? " · selected for canonical value" : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </article>
            );
          })}
        </div>
      </section>

      <section className="detail-panel" aria-labelledby="differences-heading">
        <p className="eyebrow">Duplicate-source differences</p>
        <h2 id="differences-heading">What each source says</h2>
        <div className="source-difference-table" role="table">
          {detail.sources.map((source) => (
            <div role="row" key={source.record.id}>
              <strong role="cell">{sourceNames[source.record.source]}</strong>
              <span role="cell">
                {money(source.snapshot?.details.baseRentCents ?? source.record.monthlyRentCents)}
              </span>
              <span role="cell">
                {source.snapshot?.details.availableOn ??
                  source.record.availableOn ??
                  "Availability unknown"}
              </span>
              <span role="cell">{String(source.snapshot?.photos.length ?? 0)} photos</span>
            </div>
          ))}
        </div>
      </section>

      {viewingEligible ? (
        <ViewingPlanner
          listingId={listingId}
          demoMode={demoMode}
          holdCapabilityState={holdCapabilityState}
        />
      ) : null}

      <div className="detail-grid">
        <section className="detail-panel" aria-labelledby="fit-heading">
          <p className="eyebrow">
            Versioned deterministic score · separate from detail completeness
          </p>
          <h2 id="fit-heading">Vera fit explanation</h2>
          <p className="detail-callout detail-callout-positive">
            {detail.summary.topPositiveReason ?? "No positive fit reason is available."}
          </p>
          <p className="detail-callout detail-callout-concern">
            {detail.summary.topConcern ?? "No open fit concern."}
          </p>
          <div className="factor-list">
            {detail.score?.factors.map((factor) => (
              <div className="factor-row" key={factor.code}>
                <span>{label(factor.code)}</span>
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
          <small>Version: {detail.score?.algorithmVersion ?? "not available"}</small>
        </section>
        <section className="detail-panel" aria-labelledby="risk-heading">
          <p className="eyebrow">Evidence, not a verdict</p>
          <h2 id="risk-heading">Risk indicators</h2>
          {detail.risks.length === 0 ? (
            <p>No deterministic risk indicator is open.</p>
          ) : (
            <div className="risk-list">
              {detail.risks.map((risk) => (
                <article className={`risk-card risk-card-${risk.severity}`} key={risk.id}>
                  <span>{risk.severity} · needs verification</span>
                  <h3>{label(risk.code)}</h3>
                  {risk.evidence.map((evidence) => (
                    <p
                      key={`${risk.id}-${evidence.sourceRecordId}-${evidence.fieldPath ?? "record"}`}
                    >
                      {evidence.summary}
                    </p>
                  ))}
                  <strong>Verify: {risk.verificationAction}</strong>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <button className="secondary-button" type="button" disabled>
        Prepare outreach — coming next
      </button>

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
          detail.activity.slice(0, 10).map((event) => (
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
