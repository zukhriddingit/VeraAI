import { describe, expect, it } from "vitest";

import { RentalResearchRunStatusSchema, RunRentalResearchRequestSchema } from "./live-search.ts";

describe("multi-source rental research contracts", () => {
  it("requires an explicit unique source selection and founder confirmation", () => {
    expect(
      RunRentalResearchRequestSchema.parse({
        veraRunId: "run-13b",
        searchProfileId: "profile-1",
        selectedSources: ["rentcast", "zillow"],
        confirmedExternalUsage: true
      })
    ).toMatchObject({ selectedSources: ["rentcast", "zillow"] });
    expect(() =>
      RunRentalResearchRequestSchema.parse({
        veraRunId: "run-13b",
        searchProfileId: "profile-1",
        selectedSources: ["zillow", "zillow"],
        confirmedExternalUsage: true
      })
    ).toThrow();
  });

  it("represents partial completion without erasing a successful source", () => {
    expect(
      RentalResearchRunStatusSchema.parse({
        searchRunId: "run-13b",
        searchProfileId: "profile-1",
        phase: "completed",
        sources: [
          {
            source: "rentcast",
            state: "completed",
            retrievedCount: 3,
            importedCount: 3,
            rejectedCount: 0,
            manualAction: null,
            message: null
          },
          {
            source: "zillow",
            state: "failed",
            retrievedCount: 0,
            importedCount: 0,
            rejectedCount: 0,
            manualAction: null,
            message: "Zillow stopped safely."
          }
        ],
        partial: true,
        completedAt: "2026-07-30T12:00:00.000Z"
      })
    ).toMatchObject({ partial: true });
  });
});
