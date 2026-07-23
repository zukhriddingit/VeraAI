import { expect, test } from "@playwright/test";

test("manual capture normalizes supplied evidence without fetching its URL", async ({ page }) => {
  await page.goto("/connectors");

  await expect(page.getByRole("heading", { name: "Connector status" })).toBeVisible();
  await expect(page.locator(".connector-card")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByText("ready", { exact: true })).toHaveCount(2);
  await expect(page.getByText("disabled", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Unknown domains stay manual." })).toBeVisible();
  await expect(page.getByText(/future browser access requires a separate/u)).toBeVisible();

  await page.getByRole("link", { name: "Capture a listing" }).click();
  await expect(page.getByRole("heading", { name: "Capture a listing" })).toBeVisible();
  await expect(page.getByText(/does not open or fetch the URL/u)).toBeVisible();

  await page.getByLabel(/Listing URL/u).fill("https://housing.example/e2e/synthetic-listing");
  await page
    .getByLabel("Pasted listing text")
    .fill(
      "Base rent: USD 2450 per month\n1 bed\n1 bath\nAddress: 101 E2E Example Way\nPosted: 2026-07-17\nContact me through the platform"
    );
  await page.getByRole("button", { name: "Capture supplied evidence" }).click();

  await expect(page.getByRole("heading", { name: "Evidence captured", exact: true })).toBeVisible({
    timeout: 20_000
  });
  await expect(page.locator(".capture-fields")).toContainText("$2,450");
  await expect(page.locator(".capture-fields")).toContainText("Unknown");
  const evidenceLink = page.getByRole("link", { name: "View extraction evidence" });
  await expect(evidenceLink).toHaveAttribute("href", /^\/captures\/[a-zA-Z0-9._:-]+$/u);

  await page.getByRole("button", { name: "Capture supplied evidence" }).click();
  await expect(page.getByRole("heading", { name: "Existing evidence reused" })).toBeVisible({
    timeout: 20_000
  });

  await page.getByRole("link", { name: "View extraction evidence" }).click();
  await expect(page).toHaveURL(/\/captures\/[a-zA-Z0-9._:-]+$/u);
  await expect(page.getByRole("heading", { name: "Extraction evidence" })).toBeVisible();
  await expect(page.getByText("completed", { exact: true })).toBeVisible();
  await expect(page.getByText("Deterministic only", { exact: true })).toBeVisible();
  await expect(page.locator(".evidence-field")).toHaveCount(22);
  await expect(page.locator(".evidence-field-status-known").first()).toContainText("Known");
  await expect(page.locator(".evidence-field-status-unknown").first()).toContainText("Unknown");
  await expect(page.locator(".evidence-field").filter({ hasText: "Base rent" })).toContainText(
    "$2,450/month"
  );
  await expect(page.getByText("Method", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Confidence", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Quoted evidence", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Explanation", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(/Matched supplied listing evidence with a deterministic rule/u).first()
  ).toBeVisible();
  await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByText(/canonical listing/iu)).toHaveCount(0);
  await expect(page.getByText(/AI certainty/iu)).toHaveCount(0);
});
