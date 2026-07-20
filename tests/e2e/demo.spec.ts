import { expect, test } from "@playwright/test";

test("offline golden path preserves evidence, explains risk, and records user control", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.locator(".demo-banner")).toContainText(
    "Demo mode — sanitized fixture data; no live marketplace accounts connected."
  );
  await expect(page.getByRole("heading", { name: "Harbor City September Search" })).toBeVisible();
  await expect(page.getByText("$2,600 target · $3,000 max")).toBeVisible();
  const runSearch = page.getByRole("button", { name: "Run demo search" });
  if (await runSearch.isVisible()) {
    await expect(page.getByText("No demo results yet")).toBeVisible();
    await runSearch.click();
  } else {
    await expect(page.getByRole("button", { name: "Demo search complete" })).toBeDisabled();
  }

  await expect(
    page.getByText("12 source records analyzed · 8 homes found · 3 duplicate clusters.")
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("listing-card")).toHaveCount(8);
  await expect(page.getByTestId("duplicate-badge")).toHaveCount(3);
  await expect(page.getByText("Zillow", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Facebook Marketplace", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Craigslist", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Apartments.com", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "View evidence for Juniper Row one-bedroom" }).click();

  await expect(
    page.getByRole("heading", { name: "101 Juniper Row, 1A, Harbor City, MA" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fit explanation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk indicators" })).toBeVisible();
  await expect(page.locator(".risk-card")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Deposit before viewing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Suspicious payment method" })).toBeVisible();
  await expect(
    page.getByText(/deterministic listing-dedupe\.v1 clustering linked records/u)
  ).toBeVisible();
  await expect(page.getByText("Version: listing-score.v2")).toBeVisible();
  await expect(page.locator(".source-evidence-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Prepare outreach — coming next" })).toBeDisabled();

  const addToShortlist = page.getByRole("button", { name: "Add to shortlist" });
  if (await addToShortlist.isVisible()) await addToShortlist.click();
  await expect(page.getByRole("button", { name: "Remove from shortlist" })).toBeVisible();
  await expect(page.getByText("Listing added to the shortlist.")).toBeVisible();

  await page.getByRole("link", { name: "View all activity →" }).click();
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "listing.shortlisted" })).toBeVisible();
  await expect(page.getByText("Listing added to the shortlist.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "demo.search.completed" })).toBeVisible();
  await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
});
