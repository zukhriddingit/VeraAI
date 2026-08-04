import { describe, expect, it } from "vitest";

import { assertSafeControl, extractSourceCards, parseSourceSnapshot } from "./source-snapshot.mjs";

const observedAt = "2026-08-04T15:00:00.000Z";

describe("bounded source snapshots", () => {
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
      amenities: expect.arrayContaining(["Fitness center", "Dishwasher", "In-unit laundry"])
    });
    expect(JSON.stringify(cards)).not.toMatch(/857|email/iu);
  });

  it("canonicalizes an observed Marketplace item URL without tracking data", () => {
    const name = "2 Beds 1 Bath - Apartment, $1,995, Allston, MA, listing 123456789";
    const document = parseSourceSnapshot(
      {
        ok: true,
        format: "ai",
        targetId: "shared-tab-1",
        url: "https://www.facebook.com/marketplace/boston/category/propertyrentals/",
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

  it("rejects forbidden or unobserved controls", () => {
    for (const name of [
      "Contact",
      "Apply now",
      "Request a tour",
      "Message seller",
      "Email",
      "Phone",
      "Upload",
      "Download"
    ]) {
      expect(() => assertSafeControl({ ref: "e1", role: "button", name })).toThrow(
        "forbidden_or_unobserved_control"
      );
    }
  });
});
