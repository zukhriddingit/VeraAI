import { describe, expect, it } from "vitest";

import {
  AgentRentalAnalysisSchema,
  RunLiveSearchRequestSchema,
  validateAgentRentalAnalysis
} from "./index.ts";

function validAnalysis() {
  return {
    schemaVersion: "1" as const,
    searchRunId: "live-search-1",
    recommendations: [
      {
        providerListingId: "rentcast-1",
        recommended: true,
        confidence: 0.8,
        summary: "Good budget alignment; verify the missing pet policy.",
        strengths: ["Within the stated maximum rent."],
        watchouts: ["Pet policy is not supplied."],
        missingFacts: ["Required recurring fees."]
      }
    ]
  };
}

describe("live rental search contracts", () => {
  it("requires an explicit external-usage confirmation", () => {
    expect(() =>
      RunLiveSearchRequestSchema.parse({
        searchProfileId: "profile-1",
        confirmedExternalUsage: false
      })
    ).toThrow();
  });

  it("accepts only recommendations from the expected run and candidates", () => {
    expect(validateAgentRentalAnalysis(validAnalysis(), "live-search-1", ["rentcast-1"])).toEqual(
      validAnalysis()
    );
    expect(() =>
      validateAgentRentalAnalysis(validAnalysis(), "live-search-2", ["rentcast-1"])
    ).toThrow(/search-run ID/u);
    expect(() =>
      validateAgentRentalAnalysis(validAnalysis(), "live-search-1", ["rentcast-2"])
    ).toThrow(/candidate set/u);
  });

  it.each([
    ["unknown fields", { ...validAnalysis(), arbitrary: true }],
    [
      "duplicate provider IDs",
      {
        ...validAnalysis(),
        recommendations: [validAnalysis().recommendations[0], validAnalysis().recommendations[0]]
      }
    ],
    [
      "URLs",
      {
        ...validAnalysis(),
        recommendations: [
          { ...validAnalysis().recommendations[0], summary: "See https://example.test" }
        ]
      }
    ],
    [
      "contact instructions",
      {
        ...validAnalysis(),
        recommendations: [
          { ...validAnalysis().recommendations[0], summary: "Call the landlord now." }
        ]
      }
    ],
    [
      "certainty language",
      {
        ...validAnalysis(),
        recommendations: [
          {
            ...validAnalysis().recommendations[0],
            summary: "This listing is definitely legitimate."
          }
        ]
      }
    ]
  ])("rejects %s", (_label, analysis) => {
    expect(() => AgentRentalAnalysisSchema.parse(analysis)).toThrow();
  });
});
