import { expect, test } from "@playwright/test";

const baseStatus = {
  searchRunId: "live-search-ui-1",
  searchProfileId: "profile-demo-harbor-city",
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

test("founder confirms external usage and sees the completed live-search banner", async ({
  page
}) => {
  await page.route("**/api/live-search", async (route) => {
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
  await expect(page.getByRole("heading", { name: "Run live agent search" })).toBeVisible();
  const button = page.getByRole("button", { name: "Run live agent search" });
  await expect(button).toBeDisabled();
  await page.getByLabel(/I understand this uses live RentCast/u).check();
  await button.click();
  await expect(
    page.getByText("Live results — RentCast inventory analyzed by OpenClaw on Maritime.")
  ).toBeVisible();
  await expect(page.getByText("OpenClaw on Maritime", { exact: true })).toBeVisible();
});
