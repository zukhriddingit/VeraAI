import { expect, test, type Page } from "@playwright/test";

async function ensureDemoSearch(page: Page): Promise<void> {
  await page.goto("/");
  const run = page.getByRole("button", { name: "Run demo search" });
  if (await run.isVisible()) await run.click();
  await page.getByRole("button", { name: /All \d+/u }).click();
  await expect(page.getByTestId("listing-card")).toHaveCount(8, { timeout: 20_000 });
}

test("inbox filters, sorts, shortlists, dismisses, and audits renter decisions", async ({
  page
}) => {
  await ensureDemoSearch(page);

  const sourceFilter = page
    .locator(".filter-control")
    .filter({ has: page.getByText("Source", { exact: true }) })
    .getByRole("combobox");
  await sourceFilter.selectOption("zillow");
  await expect(page.getByTestId("listing-card")).toHaveCount(3);
  await expect(page.locator(".listing-sources").getByText("Zillow", { exact: true })).toHaveCount(
    3
  );

  await sourceFilter.selectOption("all");
  await page.getByLabel("Sort by").selectOption("price");
  await expect(page.getByTestId("listing-card").first()).toContainText("Pine Court studio");

  const shortlistCedar = page.getByRole("button", {
    name: "Add Cedar Passage flat to shortlist"
  });
  if (await shortlistCedar.isVisible()) {
    await shortlistCedar.click();
    await expect(page.getByText("Listing added to the shortlist.")).toBeVisible();
  }
  await page.getByRole("button", { name: /Shortlisted \d+/u }).click();
  await expect(
    page.getByTestId("listing-card").filter({ hasText: "Cedar Passage flat" })
  ).toBeVisible();

  await page.getByRole("button", { name: /New \d+/u }).click();
  const orchardCard = page.getByTestId("listing-card").filter({ hasText: "Orchard Lane loft" });
  const dismissOrchard = orchardCard.getByRole("button", { name: "Dismiss Orchard Lane loft" });
  if (await dismissOrchard.isVisible()) {
    await dismissOrchard.click();
    await orchardCard.getByRole("button", { name: "Confirm" }).click();
    await expect(
      page.getByText("Listing dismissed and preserved in Archived with an audit event.")
    ).toBeVisible();
  }

  await page.getByRole("button", { name: /Archived \d+/u }).click();
  await expect(
    page.getByTestId("listing-card").filter({ hasText: "Orchard Lane loft" })
  ).toBeVisible();

  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity log" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "listing.dismissed" })).toBeVisible();
  await expect(page.getByText("Listing dismissed from the active inbox.")).toBeVisible();
});
