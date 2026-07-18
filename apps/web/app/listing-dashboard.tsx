"use client";

import {
  CanonicalListingCollectionResponseSchema,
  ListingsUnavailableResponseSchema,
  type CanonicalListingSummary
} from "@vera/domain";
import { useEffect, useState } from "react";
import Link from "next/link";

type ListingState =
  | { kind: "loading" }
  | { kind: "ready"; listings: readonly CanonicalListingSummary[] }
  | { kind: "unavailable"; message: string };

const sourceNames = {
  zillow: "Zillow",
  facebook_marketplace: "Facebook Marketplace",
  craigslist: "Craigslist",
  apartments_com: "Apartments.com",
  other: "Other"
} as const;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function formatMoney(cents: number | null): string {
  return cents === null ? "Unknown" : currency.format(cents / 100);
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
  if (value === null) {
    return `${singular} unknown`;
  }

  return `${String(value)} ${value === 1 ? singular : `${singular}s`}`;
}

const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function formatFreshness(value: string): string {
  return `Observed ${date.format(new Date(value))}`;
}

function fitScore(value: number | null): string {
  if (value === null) return "Not scored";
  return `${String(Math.round((value + 10_000) / 200))}% fit`;
}

const fitLabels = {
  strong_fit: "Strong fit",
  possible_fit: "Possible fit",
  needs_review: "Needs review"
} as const;

function ListingCard({ listing }: { listing: CanonicalListingSummary }) {
  return (
    <article className="listing-card" data-testid="listing-card">
      <div className="listing-card-topline">
        <span
          className={`listing-state ${listing.lifecycleState === "shortlisted" ? "listing-state-shortlisted" : ""}`}
        >
          {listing.lifecycleState === "shortlisted" ? "Shortlisted" : "New match"}
        </span>
        {listing.duplicateCount > 0 ? (
          <span className="duplicate-badge" data-testid="duplicate-badge">
            {String(listing.duplicateCount)} duplicate{" "}
            {listing.duplicateCount === 1 ? "source" : "sources"}
          </span>
        ) : null}
      </div>
      <div>
        <h3>{listing.title}</h3>
        <p className="listing-address">{formatAddress(listing)}</p>
      </div>
      <div className="listing-facts" aria-label={`Facts for ${listing.title}`}>
        <span>
          <strong>{formatMoney(listing.monthlyRentCents)}</strong>
          <small>monthly rent</small>
        </span>
        <span>
          <strong>{formatRoomCount(listing.bedrooms, "bed")}</strong>
          <small>{formatRoomCount(listing.bathrooms, "bath")}</small>
        </span>
        <span>
          <strong>
            {listing.squareFeet === null ? "Unknown" : `${String(listing.squareFeet)} ft²`}
          </strong>
          <small>interior size</small>
        </span>
      </div>
      <div className="listing-sources" aria-label={`Sources for ${listing.title}`}>
        {listing.sourceLabels.map((source) => (
          <span key={source}>{sourceNames[source]}</span>
        ))}
      </div>
      <div className="listing-fit-row">
        <span className={`fit-pill fit-pill-${listing.fitLabel ?? "unscored"}`}>
          {listing.fitLabel ? fitLabels[listing.fitLabel] : "Not scored"} ·{" "}
          {fitScore(listing.fitScoreBasisPoints)}
        </span>
        <span
          className={listing.riskIndicatorCount > 0 ? "risk-count risk-count-open" : "risk-count"}
        >
          {String(listing.riskIndicatorCount)} risk{" "}
          {listing.riskIndicatorCount === 1 ? "indicator" : "indicators"}
        </span>
      </div>
      {listing.topPositiveReason ? (
        <p className="fit-reason fit-reason-positive">{listing.topPositiveReason}</p>
      ) : null}
      {listing.topConcern ? (
        <p className="fit-reason fit-reason-concern">{listing.topConcern}</p>
      ) : null}
      <div className="listing-card-footer">
        <span>{formatFreshness(listing.freshestObservedAt)}</span>
        <Link
          className="evidence-link"
          href={`/listings/${listing.id}`}
          aria-label={`View evidence for ${listing.title}`}
        >
          View evidence <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}

export function ListingDashboard({
  refreshKey = 0,
  demoMode = false
}: {
  refreshKey?: number;
  demoMode?: boolean;
}) {
  const [state, setState] = useState<ListingState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadListings() {
      try {
        const response = await fetch("/api/listings", {
          cache: "no-store",
          signal: controller.signal
        });
        const body: unknown = await response.json();

        if (!response.ok) {
          const unavailable = ListingsUnavailableResponseSchema.parse(body);
          setState({ kind: "unavailable", message: unavailable.message });
          return;
        }

        const collection = CanonicalListingCollectionResponseSchema.parse(body);
        setState({ kind: "ready", listings: collection.listings });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({
          kind: "unavailable",
          message: "Local listing data is unavailable. Run pnpm db:migrate and pnpm db:seed."
        });
      }
    }

    void loadListings();

    return () => {
      controller.abort();
    };
  }, [refreshKey]);

  if (state.kind === "loading") {
    return (
      <div className="listing-message" role="status" aria-live="polite">
        Loading local listings…
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="listing-message listing-message-warning" role="status" aria-live="polite">
        <strong>Listing data is not ready.</strong>
        <span>{state.message}</span>
      </div>
    );
  }

  if (state.listings.length === 0) {
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

  return (
    <div className="listing-grid" aria-live="polite">
      {state.listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} />
      ))}
    </div>
  );
}
