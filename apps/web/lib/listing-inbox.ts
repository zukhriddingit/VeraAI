import type {
  CanonicalListingSummary,
  ListingLifecycleState,
  ListingSourceLabel
} from "@vera/domain";

export const ListingInboxTabValues = [
  "new",
  "shortlisted",
  "contacted",
  "tours",
  "archived",
  "all"
] as const;
export const ListingInboxSortValues = ["fit", "freshness", "price", "risk"] as const;
export const ListingInboxConstraintValues = ["all", "eligible", "excluded", "unknown"] as const;

export type ListingInboxTab = (typeof ListingInboxTabValues)[number];
export type ListingInboxSort = (typeof ListingInboxSortValues)[number];
export type ListingInboxConstraint = (typeof ListingInboxConstraintValues)[number];

export interface ListingInboxQuery {
  readonly tab: ListingInboxTab;
  readonly sort: ListingInboxSort;
  readonly constraint: ListingInboxConstraint;
  readonly missingFactsOnly: boolean;
  readonly duplicatesOnly: boolean;
  readonly source: ListingSourceLabel | "all";
}

const lifecycleTabs: Readonly<
  Record<Exclude<ListingInboxTab, "all">, readonly ListingLifecycleState[]>
> = {
  new: ["new"],
  shortlisted: ["shortlisted", "draft_ready", "draft_rejected"],
  contacted: ["draft_created", "replied", "follow_up_due"],
  tours: ["tour_proposed", "tour_scheduled", "toured"],
  archived: ["applying", "passed", "dismissed", "stale", "unavailable"]
};

export const DEFAULT_LISTING_INBOX_QUERY: ListingInboxQuery = Object.freeze({
  tab: "new",
  sort: "fit",
  constraint: "all",
  missingFactsOnly: false,
  duplicatesOnly: false,
  source: "all"
});

export function listingMatchesTab(
  lifecycleState: ListingLifecycleState,
  tab: ListingInboxTab
): boolean {
  return tab === "all" || lifecycleTabs[tab].includes(lifecycleState);
}

export function listingMonthlyTotalCents(listing: CanonicalListingSummary): number | null {
  return listing.monthlyRentCents === null || listing.recurringFeesCents === null
    ? null
    : listing.monthlyRentCents + listing.recurringFeesCents;
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: "ascending" | "descending"
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "ascending" ? left - right : right - left;
}

function compareListings(
  left: CanonicalListingSummary,
  right: CanonicalListingSummary,
  sort: ListingInboxSort
): number {
  switch (sort) {
    case "fit": {
      const eligibility = Number(right.eligible !== false) - Number(left.eligible !== false);
      return (
        eligibility ||
        compareNullableNumbers(left.fitScoreBasisPoints, right.fitScoreBasisPoints, "descending")
      );
    }
    case "freshness":
      return right.freshestObservedAt.localeCompare(left.freshestObservedAt);
    case "price":
      return compareNullableNumbers(
        listingMonthlyTotalCents(left),
        listingMonthlyTotalCents(right),
        "ascending"
      );
    case "risk":
      return (
        riskSeverityRank(right.highestRiskSeverity) - riskSeverityRank(left.highestRiskSeverity) ||
        right.riskIndicatorCount - left.riskIndicatorCount
      );
  }
}

function riskSeverityRank(severity: CanonicalListingSummary["highestRiskSeverity"]): number {
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  if (severity === "info") return 1;
  return 0;
}

export function listingInboxTabCounts(
  listings: readonly CanonicalListingSummary[]
): Readonly<Record<ListingInboxTab, number>> {
  return Object.fromEntries(
    ListingInboxTabValues.map((tab) => [
      tab,
      listings.filter(({ lifecycleState }) => listingMatchesTab(lifecycleState, tab)).length
    ])
  ) as Readonly<Record<ListingInboxTab, number>>;
}

export function refineListingInbox(
  listings: readonly CanonicalListingSummary[],
  query: ListingInboxQuery
): readonly CanonicalListingSummary[] {
  return listings
    .map((listing, index) => ({ listing, index }))
    .filter(({ listing }) => listingMatchesTab(listing.lifecycleState, query.tab))
    .filter(({ listing }) => {
      switch (query.constraint) {
        case "eligible":
          return listing.eligible === true;
        case "excluded":
          return listing.eligible === false;
        case "unknown":
          return listing.eligible === null || listing.eligible === undefined;
        case "all":
          return true;
      }
    })
    .filter(({ listing }) => !query.missingFactsOnly || listing.unknownFields.length > 0)
    .filter(({ listing }) => !query.duplicatesOnly || listing.duplicateCount > 0)
    .filter(({ listing }) => query.source === "all" || listing.sourceLabels.includes(query.source))
    .sort(
      (left, right) =>
        compareListings(left.listing, right.listing, query.sort) || left.index - right.index
    )
    .map(({ listing }) => listing);
}
