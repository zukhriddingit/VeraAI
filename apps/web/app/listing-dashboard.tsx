"use client";

import {
  CanonicalListingCollectionResponseSchema,
  DismissListingResponseSchema,
  ListingsUnavailableResponseSchema,
  ShortlistResponseSchema,
  type CanonicalListingSummary,
  type ListingLifecycleState,
  type ListingSourceLabel
} from "@vera/domain";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  DEFAULT_LISTING_INBOX_QUERY,
  listingInboxTabCounts,
  listingMonthlyTotalCents,
  refineListingInbox,
  type ListingInboxQuery,
  type ListingInboxTab
} from "../lib/listing-inbox";

type ListingState =
  | { kind: "loading" }
  | { kind: "ready"; listings: readonly CanonicalListingSummary[] }
  | { kind: "unavailable"; message: string };

const sourceNames: Record<ListingSourceLabel, string> = {
  zillow: "Zillow",
  facebook_marketplace: "Facebook Marketplace",
  craigslist: "Craigslist",
  apartments_com: "Apartments.com",
  other: "Other"
};
const tabNames: Readonly<Record<ListingInboxTab, string>> = {
  new: "New",
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  tours: "Tours",
  archived: "Archived",
  all: "All"
};
const tabOrder = ["new", "shortlisted", "contacted", "tours", "archived", "all"] as const;
const dismissibleStates: readonly ListingLifecycleState[] = [
  "new",
  "shortlisted",
  "draft_ready",
  "draft_created",
  "draft_rejected",
  "replied",
  "follow_up_due",
  "tour_proposed",
  "tour_scheduled"
];
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatMoney(cents: number): string {
  return currency.format(cents / 100);
}

function formatAddress(listing: CanonicalListingSummary): string {
  const parts = [
    listing.address.line1,
    listing.address.unit,
    listing.address.city,
    listing.address.region
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : "Address unknown";
}

function formatRoomCount(value: number | null, singular: string): string {
  if (value === null) return `${singular} unknown`;
  return `${String(value)} ${value === 1 ? singular : `${singular}s`}`;
}

function formatMonthlyTotal(listing: CanonicalListingSummary): {
  readonly value: string;
  readonly label: string;
  readonly partial: boolean;
} {
  const total = listingMonthlyTotalCents(listing);
  if (total !== null) return { value: formatMoney(total), label: "monthly total", partial: false };
  if (listing.monthlyRentCents !== null) {
    return { value: formatMoney(listing.monthlyRentCents), label: "+ fees unknown", partial: true };
  }
  return { value: "Cost unknown", label: "needs verification", partial: true };
}

function fitScore(value: number | null): string {
  if (value === null) return "Not scored";
  return `${String(Math.round(Math.max(0, Math.min(10_000, value)) / 100))}%`;
}

function petStatus(listing: CanonicalListingSummary): string {
  if (listing.petPolicy === null) return "Pets unknown";
  if (listing.petPolicy.cats === "allowed" && listing.petPolicy.dogs === "allowed") {
    return "Cats + dogs allowed";
  }
  if (listing.petPolicy.cats === "allowed") return "Cats allowed";
  if (listing.petPolicy.dogs === "allowed") return "Dogs allowed";
  if (listing.petPolicy.cats === "not_allowed" && listing.petPolicy.dogs === "not_allowed") {
    return "Pets not allowed";
  }
  return "Pet policy partial";
}

function lifecycleLabel(state: ListingLifecycleState): string {
  return state.replaceAll("_", " ");
}

function formatLatency(seconds: number | null): string {
  if (seconds === null) return "Alert latency unknown";
  if (seconds < 60) return `Alerted in ${String(seconds)}s`;
  if (seconds < 3_600) return `Alerted in ${String(Math.round(seconds / 60))}m`;
  return `Alerted in ${String(Math.round(seconds / 3_600))}h`;
}

interface ListingCardProps {
  readonly listing: CanonicalListingSummary;
  readonly busy: boolean;
  readonly confirmingDismiss: boolean;
  onShortlist(listing: CanonicalListingSummary): void;
  onAskDismiss(listingId: string): void;
  onCancelDismiss(): void;
  onDismiss(listing: CanonicalListingSummary): void;
}

function ListingCard({
  listing,
  busy,
  confirmingDismiss,
  onShortlist,
  onAskDismiss,
  onCancelDismiss,
  onDismiss
}: ListingCardProps) {
  const cost = formatMonthlyTotal(listing);
  const shortlisted = listing.lifecycleState === "shortlisted";
  const canShortlist = listing.lifecycleState === "new" || shortlisted;
  const canDismiss = dismissibleStates.includes(listing.lifecycleState);
  const stale = listing.lifecycleState === "stale" || (listing.stalePenaltyBasisPoints ?? 0) > 0;

  return (
    <article className="listing-card" data-testid="listing-card">
      <div
        className="listing-photo-placeholder"
        role="img"
        aria-label={`No approved photo available for ${listing.title}`}
      >
        <span>{listing.address.line1?.slice(0, 1) ?? "V"}</span>
        <small>Photo not supplied</small>
      </div>
      <div className="listing-card-body">
        <div className="listing-card-topline">
          <span className={`listing-state ${shortlisted ? "listing-state-shortlisted" : ""}`}>
            {lifecycleLabel(listing.lifecycleState)}
          </span>
          <div className="listing-card-badges">
            {stale ? <span className="stale-badge">Stale</span> : null}
            {listing.duplicateCount > 0 ? (
              <span className="duplicate-badge" data-testid="duplicate-badge">
                {String(listing.sourceRecordCount)} sources
              </span>
            ) : null}
          </div>
        </div>

        <div className="listing-card-heading">
          <div>
            <h3>{listing.title}</h3>
            <p className="listing-address">{formatAddress(listing)}</p>
          </div>
          <div className="score-orb" aria-label={`${fitScore(listing.fitScoreBasisPoints)} fit`}>
            <strong>{fitScore(listing.fitScoreBasisPoints)}</strong>
            <small>fit</small>
          </div>
        </div>

        <div className="listing-facts" aria-label={`Facts for ${listing.title}`}>
          <span className={cost.partial ? "fact-partial" : ""}>
            <strong>{cost.value}</strong>
            <small>{cost.label}</small>
          </span>
          <span>
            <strong>{formatRoomCount(listing.bedrooms, "bed")}</strong>
            <small>{formatRoomCount(listing.bathrooms, "bath")}</small>
          </span>
          <span>
            <strong>{listing.availableOn ?? "Move-in unknown"}</strong>
            <small>{petStatus(listing)}</small>
          </span>
        </div>

        <div className="listing-sources" aria-label={`Sources for ${listing.title}`}>
          {listing.sourceLabels.map((source) => (
            <span key={source}>{sourceNames[source]}</span>
          ))}
        </div>

        <div className="listing-reasons">
          {listing.eligible === false ? (
            <p className="fit-reason fit-reason-concern">Excluded by a known hard constraint.</p>
          ) : null}
          {listing.topPositiveReason ? (
            <p className="fit-reason fit-reason-positive">{listing.topPositiveReason}</p>
          ) : null}
          {listing.topConcern ? (
            <p className="fit-reason fit-reason-concern">{listing.topConcern}</p>
          ) : null}
        </div>

        <div className="listing-card-meta">
          <span>
            Posted{" "}
            {listing.freshestSourcePostedAt
              ? date.format(new Date(listing.freshestSourcePostedAt))
              : "unknown"}
          </span>
          <span>Observed {date.format(new Date(listing.freshestObservedAt))}</span>
          <span>{formatLatency(listing.alertLatencySeconds)}</span>
          <span
            className={
              listing.riskIndicatorCount > 0
                ? `risk-count risk-count-open risk-count-${listing.highestRiskSeverity ?? "unknown"}`
                : "risk-count"
            }
          >
            {listing.highestRiskSeverity ? `${listing.highestRiskSeverity} · ` : ""}
            {String(listing.riskIndicatorCount)} risk{" "}
            {listing.riskIndicatorCount === 1 ? "indicator" : "indicators"}
          </span>
          {listing.unknownFields.length > 0 ? (
            <span>{String(listing.unknownFields.length)} facts unknown</span>
          ) : (
            <span>Core facts complete</span>
          )}
        </div>

        <div className="listing-card-actions">
          <Link
            className="primary-button compact-button link-button"
            href={`/listings/${listing.id}`}
            aria-label={`Inspect ${listing.title}`}
          >
            Inspect
          </Link>
          {canShortlist ? (
            <button
              className="secondary-button compact-button"
              type="button"
              disabled={busy}
              onClick={() => onShortlist(listing)}
              aria-label={`${shortlisted ? "Remove" : "Add"} ${listing.title} ${shortlisted ? "from" : "to"} shortlist`}
            >
              {busy ? "Saving…" : shortlisted ? "Unshortlist" : "Shortlist"}
            </button>
          ) : null}
          {canDismiss && !confirmingDismiss ? (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => onAskDismiss(listing.id)}
              aria-label={`Dismiss ${listing.title}`}
            >
              Dismiss
            </button>
          ) : null}
          {confirmingDismiss ? (
            <div
              className="dismiss-confirmation"
              role="group"
              aria-label={`Confirm dismissal of ${listing.title}`}
            >
              <span>Move to Archived?</span>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() => onDismiss(listing)}
              >
                {busy ? "Dismissing…" : "Confirm"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={onCancelDismiss}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ListingDashboard({
  initialListings,
  refreshKey = 0,
  demoMode = false
}: {
  initialListings: readonly CanonicalListingSummary[];
  refreshKey?: number;
  demoMode?: boolean;
}) {
  const [state, setState] = useState<ListingState>({ kind: "ready", listings: initialListings });
  const [query, setQuery] = useState<ListingInboxQuery>(DEFAULT_LISTING_INBOX_QUERY);
  const [reloadKey, setReloadKey] = useState(0);
  const [busyListingId, setBusyListingId] = useState<string | null>(null);
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (refreshKey === 0 && reloadKey === 0) return;
    const controller = new AbortController();

    async function loadListings() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setState({ kind: "loading" });
      try {
        const response = await fetch("/api/listings", {
          cache: "no-store",
          signal: controller.signal
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          setState({
            kind: "unavailable",
            message: ListingsUnavailableResponseSchema.parse(body).message
          });
          return;
        }
        const collection = CanonicalListingCollectionResponseSchema.parse(body);
        setState({ kind: "ready", listings: collection.listings });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          kind: "unavailable",
          message: "Local listing data is unavailable. Run pnpm db:migrate and pnpm db:seed."
        });
      }
    }

    void loadListings();
    return () => controller.abort();
  }, [refreshKey, reloadKey]);

  const listings = state.kind === "ready" ? state.listings : [];
  const visibleListings = refineListingInbox(listings, query);
  const tabCounts = listingInboxTabCounts(listings);

  function updateListingState(listingId: string, lifecycleState: ListingLifecycleState): void {
    setState((current) =>
      current.kind === "ready"
        ? {
            kind: "ready",
            listings: current.listings.map((listing) =>
              listing.id === listingId ? { ...listing, lifecycleState } : listing
            )
          }
        : current
    );
  }

  async function toggleShortlist(listing: CanonicalListingSummary): Promise<void> {
    const shortlisted = listing.lifecycleState !== "shortlisted";
    setBusyListingId(listing.id);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/shortlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortlisted })
      });
      if (!response.ok) throw new Error("shortlist unavailable");
      const result = ShortlistResponseSchema.parse((await response.json()) as unknown);
      updateListingState(result.listingId, result.lifecycleState);
      setNotice(shortlisted ? "Listing added to the shortlist." : "Listing returned to New.");
    } catch {
      setActionError("Shortlist state could not be changed safely. Try again.");
    } finally {
      setBusyListingId(null);
    }
  }

  async function dismiss(listing: CanonicalListingSummary): Promise<void> {
    setBusyListingId(listing.id);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(listing.id)}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true })
      });
      if (!response.ok) throw new Error("dismiss unavailable");
      const result = DismissListingResponseSchema.parse((await response.json()) as unknown);
      updateListingState(result.listingId, result.lifecycleState);
      setConfirmDismissId(null);
      setNotice("Listing dismissed and preserved in Archived with an audit event.");
    } catch {
      setActionError("The listing could not be dismissed safely. Try again.");
    } finally {
      setBusyListingId(null);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="listing-message" role="status" aria-live="polite">
        Loading local listings…
      </div>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <div className="listing-message listing-message-warning" role="alert">
        <strong>Listing data is not ready.</strong>
        <span>{state.message}</span>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (listings.length === 0) {
    return (
      <div className="demo-empty-state" role="status">
        <span aria-hidden="true">⌕</span>
        <strong>{demoMode ? "No demo results yet" : "No listings yet"}</strong>
        <p>
          {demoMode
            ? "Run the sanitized demo search to reveal eight fixture-backed homes."
            : "Capture or import listing evidence to begin."}
        </p>
      </div>
    );
  }

  const filtersActive =
    query.constraint !== "all" ||
    query.missingFactsOnly ||
    query.duplicatesOnly ||
    query.source !== "all";

  return (
    <div className="cockpit-layout">
      <aside className="inbox-rail" aria-labelledby="refine-heading">
        <div>
          <p className="eyebrow">Refine this inbox</p>
          <h3 id="refine-heading">Decision filters</h3>
        </div>
        <label className="filter-control">
          <span>Hard constraints</span>
          <select
            value={query.constraint}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                constraint: event.target.value as ListingInboxQuery["constraint"]
              }))
            }
          >
            <option value="all">All results</option>
            <option value="eligible">Eligible only</option>
            <option value="excluded">Excluded only</option>
            <option value="unknown">Not evaluated</option>
          </select>
        </label>
        <label className="filter-control">
          <span>Source</span>
          <select
            value={query.source}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                source: event.target.value as ListingInboxQuery["source"]
              }))
            }
          >
            <option value="all">All sources</option>
            {Object.entries(sourceNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={query.missingFactsOnly}
            onChange={(event) =>
              setQuery((current) => ({ ...current, missingFactsOnly: event.target.checked }))
            }
          />
          <span>Missing facts</span>
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={query.duplicatesOnly}
            onChange={(event) =>
              setQuery((current) => ({ ...current, duplicatesOnly: event.target.checked }))
            }
          />
          <span>Multiple sources</span>
        </label>
        {filtersActive ? (
          <button
            className="text-button rail-clear-button"
            type="button"
            onClick={() =>
              setQuery((current) => ({
                ...DEFAULT_LISTING_INBOX_QUERY,
                tab: current.tab,
                sort: current.sort
              }))
            }
          >
            Clear filters
          </button>
        ) : null}
        <div className="rail-note">
          <strong>Unknown stays unknown.</strong>
          <p>Totals remain partial until required fees are present in source evidence.</p>
        </div>
      </aside>

      <section className="inbox-stream" aria-labelledby="inbox-results-heading">
        <div className="inbox-tabs" role="group" aria-label="Listing status">
          {tabOrder.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-pressed={query.tab === tab}
              className={query.tab === tab ? "inbox-tab inbox-tab-active" : "inbox-tab"}
              onClick={() => setQuery((current) => ({ ...current, tab }))}
            >
              {tabNames[tab]} <span>{String(tabCounts[tab])}</span>
            </button>
          ))}
        </div>

        <div className="inbox-toolbar">
          <div>
            <p className="eyebrow">{String(visibleListings.length)} visible homes</p>
            <h3 id="inbox-results-heading">{tabNames[query.tab]} listings</h3>
          </div>
          <label className="sort-control">
            <span>Sort by</span>
            <select
              value={query.sort}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  sort: event.target.value as ListingInboxQuery["sort"]
                }))
              }
            >
              <option value="fit">Best fit</option>
              <option value="freshness">Freshest</option>
              <option value="price">Lowest known total</option>
              <option value="risk">Most risk indicators</option>
            </select>
          </label>
        </div>

        <div className="action-status" aria-live="polite">
          {notice ? <p className="action-notice">{notice}</p> : null}
          {actionError ? (
            <p className="action-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>

        {visibleListings.length === 0 ? (
          <div className="filter-empty-state" role="status">
            <strong>No homes match this view.</strong>
            <p>Clear the filters or choose another status tab. No listing data was deleted.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setQuery({ ...DEFAULT_LISTING_INBOX_QUERY, tab: "all" })}
            >
              Show all listings
            </button>
          </div>
        ) : (
          <div className="listing-grid" aria-live="polite">
            {visibleListings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                busy={busyListingId === listing.id}
                confirmingDismiss={confirmDismissId === listing.id}
                onShortlist={(candidate) => void toggleShortlist(candidate)}
                onAskDismiss={setConfirmDismissId}
                onCancelDismiss={() => setConfirmDismissId(null)}
                onDismiss={(candidate) => void dismiss(candidate)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
