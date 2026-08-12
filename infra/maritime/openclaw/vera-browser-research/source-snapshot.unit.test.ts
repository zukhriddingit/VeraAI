import { describe, expect, it } from "vitest";

import {
  assertSafeControl,
  enrichSourceListingFromDetail,
  extractSourceCardCandidates,
  extractSourceCards,
  parseSourceSnapshot,
  sourceStartUrl
} from "./source-snapshot.mjs";

const observedAt = "2026-08-04T15:00:00.000Z";

describe("bounded source snapshots", () => {
  it("uses the live Marketplace rentals route that preserves the Boston result surface", () => {
    expect(
      sourceStartUrl({
        source: "facebook_marketplace",
        profile: { location: "Boston, MA" }
      })
    ).toBe("https://www.facebook.com/marketplace/boston/propertyrentals/");
  });

  it("builds a code-owned Craigslist housing query and preserves observed listing URLs", () => {
    const plan = {
      source: "craigslist",
      maxResults: 10,
      profile: {
        location: "Boston, MA",
        maximumRentUsd: 2_800,
        minimumBedrooms: 1,
        minimumBathrooms: 1,
        rentalPropertyType: "apartment"
      },
      sourceConfiguration: {
        sourceId: "craigslist",
        displayName: "Craigslist",
        adapterKind: "craigslist",
        startingUrl: "https://boston.craigslist.org/search/apa",
        allowedDomain: "boston.craigslist.org",
        loginRequired: "no",
        defaultInclude: false
      }
    };
    expect(sourceStartUrl(plan)).toContain(
      "https://boston.craigslist.org/search/apa?max_price=2800&min_bedrooms=1&min_bathrooms=1"
    );
    const listingUrl =
      "https://boston.craigslist.org/gbs/apa/d/boston-sunny-one-bedroom/1234567890.html";
    const document = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: sourceStartUrl(plan),
        refs: { e1: { role: "link", name: "Sunny one bedroom (Allston)" } },
        snapshot: [
          '- article: link "Sunny one bedroom (Allston)" [ref=e1]',
          "  - generic: $2,450, 1 bed, 1 bath, 700 ft²",
          "  - generic: posted 2 hours ago",
          "",
          "Links:",
          `1. Sunny one bedroom (Allston) -> ${listingUrl}`
        ].join("\n")
      },
      plan
    );
    expect(extractSourceCards(document, plan, observedAt)[0]).toMatchObject({
      source: "craigslist",
      sourceListingId: "1234567890",
      canonicalObservedUrl: listingUrl,
      rentUsd: 2_450,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 700,
      address: "Allston"
    });
  });

  it("resolves an observed BU card link only against its exact configured portal", () => {
    const plan = {
      source: "bu_off_campus",
      maxResults: 10,
      sourceConfiguration: {
        sourceId: "bu_off_campus",
        displayName: "BU Off-Campus Housing",
        adapterKind: "offcampus_partners",
        startingUrl: "https://offcampus.bu.edu/housing",
        allowedDomain: "offcampus.bu.edu",
        loginRequired: "unknown",
        defaultInclude: false
      }
    };
    const document = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: "https://offcampus.bu.edu/housing",
        refs: { e1: { role: "link", name: "The Longwood" } },
        snapshot: [
          '- article "The Longwood":',
          '  - link "The Longwood" [ref=e1]',
          "  - paragraph: 1575 Tremont St, Boston, MA 02120",
          "  - generic: $2,613 - $3,640 Plus Fees",
          "  - paragraph: 1 - 2 Beds 12 Month Lease",
          "  - time: 1 Day Ago",
          "",
          "Links:",
          "1. The Longwood -> /housing/property/the-longwood/c4n4rhf"
        ].join("\n")
      },
      plan
    );
    expect(extractSourceCards(document, plan, observedAt)[0]).toMatchObject({
      source: "bu_off_campus",
      sourceListingId: "c4n4rhf",
      canonicalObservedUrl: "https://offcampus.bu.edu/housing/property/the-longwood/c4n4rhf",
      propertyName: "The Longwood",
      address: "1575 Tremont St, Boston, MA 02120",
      rentUsd: 2_613,
      bedrooms: 1,
      leaseDuration: "12 Month Lease"
    });
  });

  it("extracts a sanitized Apartments.com card and ignores contact controls", () => {
    const name = "The Longwood, Boston, MA";
    const document = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: "https://www.apartments.com/boston-ma/",
        refs: {
          e1: { role: "link", name },
          e2: { role: "button", name: "Email" },
          e3: { role: "button", name: "(857) 555-0100" }
        },
        snapshot: [
          `- article:`,
          `  - link "${name}" [ref=e1]`,
          `  - generic "1575 Tremont St, Boston, MA 02120"`,
          `  - generic: 1 Bed`,
          `  - generic: $2,793+`,
          `  - generic: Updated 2 hours ago`,
          `  - paragraph: Pets Allowed, Fitness Center, Dishwasher, In Unit Washer & Dryer`,
          `  - button "Email" [ref=e2]`,
          "",
          "Links:",
          `1. ${name} -> https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/`
        ].join("\n")
      },
      "apartments_com"
    );
    const cards = extractSourceCards(
      document,
      { source: "apartments_com", maxResults: 10 },
      observedAt
    );
    expect(cards[0]).toMatchObject({
      sourceListingId: "r7nkvh2",
      propertyName: "The Longwood",
      address: "1575 Tremont St, Boston, MA 02120",
      rentUsd: 2_793,
      bedrooms: 1,
      sourceUpdatedAt: "2026-08-04T13:00:00.000Z",
      amenities: expect.arrayContaining(["Fitness center", "Dishwasher", "In-unit laundry"])
    });
    expect(JSON.stringify(cards)).not.toMatch(/857|555-0100/iu);
  });

  it("canonicalizes an observed Marketplace item URL without tracking data", () => {
    const name = "2 Beds 1 Bath - Apartment, $1,995, Allston, MA, listing 123456789";
    const document = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: "https://www.facebook.com/marketplace/boston/propertyrentals/",
        refs: { e1: { role: "link", name } },
        snapshot: [
          `- link "${name}" [ref=e1]`,
          "",
          "Links:",
          `1. ${name} -> https://www.facebook.com/marketplace/item/123456789/?ref=category_feed&tracking=redacted`
        ].join("\n")
      },
      "facebook_marketplace"
    );
    expect(
      extractSourceCards(
        document,
        { source: "facebook_marketplace", maxResults: 10 },
        observedAt
      )[0]
    ).toMatchObject({
      canonicalObservedUrl: "https://www.facebook.com/marketplace/item/123456789/",
      address: "Allston, MA",
      rentUsd: 1_995,
      bedrooms: 2,
      bathrooms: 1
    });
  });

  it("retains a semantic result reference and enriches only observed detail facts", () => {
    const name = "The Longwood, Boston, MA";
    const resultDocument = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: "https://www.apartments.com/boston-ma/",
        refs: { e8: { role: "link", name } },
        snapshot: [
          `- link "${name}" [ref=e8]`,
          "  - generic: $2,793, 1 Bed",
          "",
          "Links:",
          `1. ${name} -> https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/`
        ].join("\n")
      },
      "apartments_com"
    );
    const candidate = extractSourceCardCandidates(
      resultDocument,
      { source: "apartments_com", maxResults: 10 },
      observedAt
    )[0];
    const detailDocument = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: "https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/",
        refs: {},
        snapshot: [
          '- heading "The Longwood"',
          "- paragraph: 1575 Tremont St, Boston, MA 02120",
          "- paragraph: $2,793, 1 Bed, 1 Bath, 740 sq ft",
          "- paragraph: Available now. Dishwasher and in-unit laundry.",
          "- paragraph: Pet rent $50 monthly. Garage parking $200 monthly.",
          "- paragraph: Last updated: 2026-08-04T14:45:00Z",
          '- button "Email"'
        ].join("\n")
      },
      "apartments_com"
    );
    const enriched = enrichSourceListingFromDetail(candidate.listing, detailDocument, observedAt);

    expect(candidate).toMatchObject({ resultRef: "e8", observedLinkName: name });
    expect(enriched).toMatchObject({
      finalDetailPageUrl: "https://www.apartments.com/the-longwood-boston-ma/r7nkvh2/",
      address: "1575 Tremont St, Boston, MA 02120",
      rentUsd: 2_793,
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 740,
      availability: "Available now",
      petFees: [expect.objectContaining({ label: "Pet rent", amountUsd: 50 })],
      parkingMonthlyUsd: 200,
      sourceUpdatedAt: "2026-08-04T14:45:00.000Z"
    });
    expect(enriched.sourceFieldProvenance).toContainEqual(
      expect.objectContaining({ field: "bathrooms", observedFrom: "detail_page" })
    );
    expect(enriched.sourceFieldProvenance).toContainEqual(
      expect.objectContaining({ field: "source_updated_at", observedFrom: "detail_page" })
    );
    expect(enriched.allowedContactChannel).toBe("email");
    expect(JSON.stringify(enriched)).not.toMatch(/857|555-0100/iu);
  });

  it("rejects forbidden or unobserved controls", () => {
    for (const name of [
      "Contact",
      "Apply now",
      "Request a tour",
      "Message seller",
      "Email",
      "Phone",
      "Reply",
      "Create a posting",
      "Upload",
      "Download"
    ]) {
      expect(() => assertSafeControl({ ref: "e1", role: "button", name })).toThrow(
        "forbidden_or_unobserved_control"
      );
    }
  });
});
