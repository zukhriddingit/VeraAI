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

  it("requires one matching bounded configuration for every configurable source", () => {
    const base = {
      veraRunId: "run-configured",
      searchProfileId: "profile-1",
      selectedSources: ["custom_website"],
      confirmedExternalUsage: true
    } as const;
    expect(() => RunRentalResearchRequestSchema.parse(base)).toThrow();
    expect(
      RunRentalResearchRequestSchema.parse({
        ...base,
        housingSourceConfigurations: [
          {
            source: "custom_website",
            sourceId: "custom:housing.example.edu",
            displayName: "Example Housing",
            adapterKind: "generic",
            startingUrl: "https://housing.example.edu/search",
            allowedDomain: "housing.example.edu",
            loginRequired: "unknown",
            defaultInclude: false,
            captureCurrentPage: false
          }
        ]
      })
    ).toMatchObject({ selectedSources: ["custom_website"] });
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
          },
          {
            source: "apartments_com",
            state: "excluded_by_user",
            retrievedCount: 0,
            importedCount: 0,
            rejectedCount: 0,
            manualAction: null,
            message: null
          },
          {
            source: "facebook_marketplace",
            state: "excluded_by_user",
            retrievedCount: 0,
            importedCount: 0,
            rejectedCount: 0,
            manualAction: null,
            message: null
          }
        ],
        partial: true,
        completedAt: "2026-07-30T12:00:00.000Z"
      })
    ).toMatchObject({ partial: true });
  });
});
