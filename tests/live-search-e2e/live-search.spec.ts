import { expect, test } from "@playwright/test";

const baseStatus = {
  searchRunId: "live-search-ui-1",
  searchProfileId: "profile-cambridge-e2e",
  dataProvider: "RentCast",
  maritimeAgent: "OpenClaw on Maritime",
  retrievedCount: 1,
  importedCount: 1,
  rejectedCount: 0,
  retrievalLatencyMilliseconds: 120,
  agentLatencyMilliseconds: 240,
  totalLatencyMilliseconds: null,
  completedAt: null,
  queryHash: "a".repeat(64),
  promptVersion: "vera-live-rental-analysis.v1",
  agentSchemaVersion: "1"
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
      body: JSON.stringify({ ...baseStatus, state: "importing" })
    });
  });
  await page.route("**/api/live-search/live-search-ui-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...baseStatus,
        state: "completed",
        totalLatencyMilliseconds: 500,
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

  const button = page.getByRole("button", { name: "Search now" });
  await expect(button).toBeDisabled();
  await page.getByLabel(/I understand this uses live RentCast/u).check();
  await button.click();
  expect(liveSearchCalls).toBe(1);
  expect(liveSearchBody).toMatchObject({
    searchProfileId: createdProfile.id,
    confirmedExternalUsage: true
  });
  await expect(
    page.getByText("Live RentCast inventory analyzed by OpenClaw on Maritime.")
  ).toBeVisible();
  await expect(page.getByText("OpenClaw on Maritime", { exact: true })).toBeVisible();
});
