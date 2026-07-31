import { expect, test } from "@playwright/test";

const baseStatus = {
  searchRunId: "pending-client-run",
  searchProfileId: "profile-cambridge-e2e",
  sources: [
    {
      source: "rentcast",
      state: "completed",
      retrievedCount: 1,
      importedCount: 1,
      rejectedCount: 0,
      manualAction: null,
      message: null
    },
    {
      source: "zillow",
      state: "completed",
      retrievedCount: 1,
      importedCount: 1,
      rejectedCount: 0,
      manualAction: null,
      message: null
    }
  ],
  partial: false,
  completedAt: null
} as const;

const interpretedDraft = {
  schemaVersion: "1",
  profileName: "Cambridge fall search",
  locationText: "Cambridge, MA",
  targetMonthlyBudgetDollars: 2_700,
  maximumMonthlyBudgetDollars: 2_900,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-30",
  pets: [],
  commuteAnchors: [],
  amenities: [{ code: "laundry_in_building", priority: "preferred" }],
  ambiguities: []
} as const;

const createdProfile = {
  id: "profile-cambridge-e2e",
  name: interpretedDraft.profileName,
  version: 1,
  locationText: interpretedDraft.locationText,
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 270_000,
  absoluteMonthlyMaximumCents: 290_000,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-30",
  petRequirements: [],
  commuteAnchors: [],
  hardConstraints: [],
  weightedPreferences: [
    {
      code: "laundry_in_building",
      weightBasisPoints: 10_000,
      unknownBehavior: "neutral",
      description: "Laundry in building"
    }
  ],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt: "2026-07-28T18:00:00.000Z",
  updatedAt: "2026-07-28T18:00:00.000Z"
} as const;

test("founder reviews and saves a profile before confirming live provider usage", async ({
  page
}) => {
  let liveSearchCalls = 0;
  let liveSearchBody: unknown = null;
  await page.route("**/api/search-profiles/interpret", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: interpretedDraft })
    });
  });
  await page.route("**/api/search-profiles", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ profile: createdProfile })
    });
  });
  await page.route("**/api/live-search", async (route) => {
    liveSearchCalls += 1;
    liveSearchBody = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        ...baseStatus,
        searchRunId: (liveSearchBody as { veraRunId: string }).veraRunId,
        phase: "importing"
      })
    });
  });
  await page.route("**/api/live-search/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...baseStatus,
        searchRunId: route.request().url().split("/").at(-1),
        phase: "completed",
        completedAt: "2026-07-24T12:00:00.000Z"
      })
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tell Vera what you're looking for." })
  ).toBeVisible();
  await page
    .getByLabel("Housing search description")
    .fill("One bedroom in Cambridge, MA under $2,900 with laundry in the building.");
  await page.getByRole("button", { name: "Review my search" }).click();
  await expect(page.getByRole("heading", { name: "Review the search profile" })).toBeVisible();
  expect(liveSearchCalls).toBe(0);

  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByText("Saved Cambridge fall search, version 1. Search is still off.")
  ).toBeVisible();
  expect(liveSearchCalls).toBe(0);

  const button = page.getByRole("button", { name: "Search selected sources" });
  await expect(button).toBeDisabled();
  await page.getByRole("checkbox", { name: "Zillow Excluded by user" }).check();
  await page.getByLabel(/I am starting this read-only search now/u).check();
  await button.click();
  expect(liveSearchCalls).toBe(1);
  expect(liveSearchBody).toMatchObject({
    searchProfileId: createdProfile.id,
    selectedSources: ["rentcast", "zillow"],
    confirmedExternalUsage: true
  });
  expect(liveSearchBody).toMatchObject({ veraRunId: expect.any(String) });
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Zillow", { exact: true }).first()).toBeVisible();
});
