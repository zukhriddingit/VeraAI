import { describe, expect, it } from "vitest";

import type { NormalizedDecisionSource } from "@vera/domain";

import { DEFAULT_RISK_CONFIG } from "./config.ts";
import { evaluateLanguageRiskCandidates } from "./language-rules.ts";

const now = "2026-07-20T18:00:00.000Z";

function source(descriptionText: string): NormalizedDecisionSource {
  return {
    sourceRecordId: "source-a",
    rawListingId: "raw-a",
    source: "other",
    connectorId: "fixture.v1",
    acquisitionMode: "fixture",
    sourceListingId: null,
    acquiredAt: now,
    observedAt: now,
    postedAt: null,
    title: "Synthetic listing",
    normalizedAddress: null,
    normalizedUnit: null,
    normalizedCity: null,
    normalizedRegion: null,
    normalizedPostalCode: null,
    normalizedCountryCode: null,
    addressMatchKey: null,
    latitude: null,
    longitude: null,
    canonicalUrl: null,
    rentCents: null,
    requiredRecurringFeeCents: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    availableOn: null,
    descriptionText,
    extractionConfidenceBasisPoints: 8_000,
    completenessBasisPoints: 4_000,
    photoHashes: [],
    contactFingerprints: [],
    fieldCandidates: [],
    normalizationReasonCodes: ["field_unknown"]
  };
}

describe("language risk indicators", () => {
  it.each([
    ["Pay by gift card today.", "suspicious_payment_method"],
    ["Send the deposit before viewing the apartment.", "deposit_before_viewing"],
    ["I am currently abroad and will courier the keys.", "out_of_country_courier_keys"],
    ["Act now; I cannot show or meet at the property.", "pressure_or_refusal_to_show"],
    ["Contact me only via WhatsApp outside this platform.", "suspicious_off_platform_contact"],
    ["Use https://bit.ly/synthetic-link for the next step.", "unusual_external_link"]
  ] as const)("finds %s", (text, code) => {
    expect(
      evaluateLanguageRiskCandidates([source(text)], DEFAULT_RISK_CONFIG).map((value) => value.code)
    ).toContain(code);
  });

  it("requires conjunction evidence for deposit, courier, pressure, and off-platform rules", () => {
    const texts = [
      "The security deposit is refundable under the lease.",
      "The owner is traveling next month.",
      "Many renters enjoy an immediate transit connection.",
      "Email the property manager with ordinary questions."
    ];
    expect(
      texts.flatMap((text) => evaluateLanguageRiskCandidates([source(text)], DEFAULT_RISK_CONFIG))
    ).toEqual([]);
  });

  it("redacts supplied email and phone details from stored evidence", () => {
    const candidates = evaluateLanguageRiskCandidates(
      [
        source(
          "Contact me only via WhatsApp at (617) 555-0123 or renter.fixture@example.com outside this platform."
        )
      ],
      DEFAULT_RISK_CONFIG
    );
    const serialized = JSON.stringify(candidates);
    expect(serialized).toContain("[redacted phone]");
    expect(serialized).toContain("[redacted email]");
    expect(serialized).not.toContain("555-0123");
    expect(serialized).not.toContain("renter.fixture@example.com");
  });
});
