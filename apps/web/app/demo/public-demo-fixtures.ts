export const PUBLIC_DEMO_FIXTURE_VERSION = "public-demo.v1" as const;

export interface PublicDemoListing {
  readonly id: string;
  readonly address: string;
  readonly rentLabel: string;
  readonly requiredFees: readonly string[];
  readonly beds: string;
  readonly baths: string;
  readonly freshness: string;
  readonly fitScore: number;
  readonly completeness: number;
  readonly sourceBadges: readonly string[];
  readonly photo: { readonly src: string | null; readonly alt: string };
  readonly availability: readonly string[];
  readonly facts: readonly string[];
  readonly amenities: readonly string[];
  readonly missing: readonly string[];
  readonly risks: readonly string[];
  readonly fitFactors: readonly {
    readonly label: string;
    readonly value: number;
    readonly reason: string;
  }[];
  readonly sources: readonly {
    readonly label: string;
    readonly url: string;
    readonly observedAt: string;
  }[];
  readonly activity: readonly { readonly label: string; readonly detail: string }[];
}

export const PUBLIC_DEMO_PROFILE = Object.freeze({
  location: "Boston, MA",
  maximumRent: 2_800,
  bedrooms: 1,
  moveIn: "September 2026",
  mustHaves: ["Pet friendly", "Laundry"]
});

export const PUBLIC_DEMO_LISTINGS: readonly PublicDemoListing[] = Object.freeze([
  {
    id: "demo-beacon-street",
    address: "Beacon Street · Boston, MA",
    rentLabel: "$2,550 / month",
    requiredFees: ["Required building fee: $35 / month"],
    beds: "1 bed",
    baths: "1 bath",
    freshness: "Observed 18 minutes ago",
    fitScore: 88,
    completeness: 84,
    sourceBadges: ["Official API", "Housing alert"],
    photo: {
      src: "/demo/beacon-home.svg",
      alt: "Sanitized illustration of a Boston apartment"
    },
    availability: ["Available September 1", "12-month lease observed"],
    facts: ["640 sq ft", "Apartment", "Laundry in building"],
    amenities: ["Cats allowed", "Heat included", "Bike storage"],
    missing: ["Application fee", "Parking cost"],
    risks: ["Broker fee needs verification"],
    fitFactors: [
      {
        label: "Budget",
        value: 100,
        reason: "$215 below the profile's monthly limit including known fees."
      },
      {
        label: "Move-in",
        value: 100,
        reason: "Observed availability matches the requested month."
      },
      {
        label: "Must-haves",
        value: 67,
        reason: "Laundry and pet policy are observed; parking cost is unknown."
      }
    ],
    sources: [
      {
        label: "Official API record",
        url: "https://example.invalid/demo/beacon-api",
        observedAt: "2026-08-13T18:05:00.000Z"
      },
      {
        label: "Sanitized housing alert",
        url: "https://example.invalid/demo/beacon-alert",
        observedAt: "2026-08-13T18:09:00.000Z"
      }
    ],
    activity: [
      {
        label: "Discovered",
        detail: "Two source records entered the immutable raw-listing pipeline."
      },
      {
        label: "Clustered",
        detail: "Deterministic dedupe retained both source records as one canonical home."
      },
      {
        label: "Scored",
        detail: "Fit was computed from the explicit demo profile; no model decided eligibility."
      }
    ]
  },
  {
    id: "demo-somerville",
    address: "Somerville Avenue · Somerville, MA",
    rentLabel: "$2,700 / month",
    requiredFees: [],
    beds: "1 bed",
    baths: "1 bath",
    freshness: "Observed 2 hours ago",
    fitScore: 81,
    completeness: 72,
    sourceBadges: ["Browser source"],
    photo: {
      src: "/demo/somerville-home.svg",
      alt: "Sanitized illustration of a Somerville rental"
    },
    availability: ["Available date not observed", "Lease duration not observed"],
    facts: ["Apartment", "Laundry in unit"],
    amenities: ["Dogs allowed", "Dishwasher"],
    missing: ["Available date", "Lease duration", "Utilities", "Application fee"],
    risks: ["Total monthly cost is incomplete"],
    fitFactors: [
      {
        label: "Budget",
        value: 100,
        reason: "Observed base rent is within the profile limit."
      },
      {
        label: "Move-in",
        value: 40,
        reason: "The source did not publish an available date."
      },
      {
        label: "Must-haves",
        value: 100,
        reason: "Pet policy and laundry were both observed."
      }
    ],
    sources: [
      {
        label: "Sanitized browser record",
        url: "https://example.invalid/demo/somerville",
        observedAt: "2026-08-13T16:18:00.000Z"
      }
    ],
    activity: [
      {
        label: "Discovered",
        detail: "A user-triggered, read-only source observation produced one raw record."
      },
      {
        label: "Needs verification",
        detail: "Availability and total recurring fees remain unknown."
      }
    ]
  },
  {
    id: "demo-allston",
    address: "Commonwealth Avenue · Allston, MA",
    rentLabel: "$2,375–$2,525 / month",
    requiredFees: ["Pet rent: $40 / month when applicable"],
    beds: "1 bed",
    baths: "1 bath",
    freshness: "Observed yesterday",
    fitScore: 76,
    completeness: 63,
    sourceBadges: ["User capture"],
    photo: { src: null, alt: "Source image unavailable" },
    availability: ["Available now", "Lease duration not observed"],
    facts: ["Apartment", "Square footage not observed"],
    amenities: ["Laundry in building"],
    missing: ["Deposit", "Application fee", "Utilities", "Property manager"],
    risks: ["Rent is a range", "Source image cannot be safely displayed"],
    fitFactors: [
      {
        label: "Budget",
        value: 82,
        reason: "The top of the observed range remains under budget before unknown fees."
      },
      {
        label: "Move-in",
        value: 75,
        reason: "The source says available now, but no lease start was observed."
      },
      {
        label: "Must-haves",
        value: 50,
        reason: "Laundry is observed; pet policy is incomplete."
      }
    ],
    sources: [
      {
        label: "Sanitized user capture",
        url: "https://example.invalid/demo/allston",
        observedAt: "2026-08-12T20:04:00.000Z"
      }
    ],
    activity: [
      {
        label: "Captured",
        detail: "The renter supplied listing text directly; the URL remained inert."
      },
      {
        label: "Normalized",
        detail: "Unknown values stayed unknown and every observed field retained provenance."
      }
    ]
  }
]);
