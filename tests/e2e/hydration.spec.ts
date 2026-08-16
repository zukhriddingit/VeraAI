import { expect, test } from "@playwright/test";

test("server-rendered listing dates hydrate without timezone drift", async ({ page }) => {
  const hydrationFailures: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|Minified React error #418|did not match/iu.test(message.text())
    ) {
      hydrationFailures.push(message.text());
    }
  });
  page.on("pageerror", (error) => hydrationFailures.push(error.message));

  await page.goto("/");
  const runSearch = page.getByRole("button", { name: "Run demo search" });
  if (await runSearch.isVisible()) await runSearch.click();
  await expect(page.getByTestId("listing-card").first()).toBeVisible({ timeout: 20_000 });

  await page.reload();

  await expect(page.getByTestId("listing-card").first()).toBeVisible();
  await expect(page.getByText(/^Observed [A-Z][a-z]{2} \d{1,2}$/u).first()).toBeVisible();
  expect(hydrationFailures).toEqual([]);
});
