import { expect, test } from "@playwright/test";

test("public demo remains local-only and useful", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
  });

  await page.goto("/demo");
  await expect(
    page.getByText("Sanitized demo — no marketplace, email, calendar, or browser actions occur.")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Three matches" })).toBeVisible();

  await page.getByLabel("Minimum fit").selectOption("80");
  await expect(page.getByRole("button", { name: /Commonwealth Avenue/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Somerville Avenue/ }).click();
  await expect(
    page.getByRole("heading", { name: "Somerville Avenue · Somerville, MA" })
  ).toBeVisible();

  const evidenceLinks = page.getByRole("link", { name: "View sanitized source evidence" });
  for (const link of await evidenceLinks.all()) {
    expect(new URL((await link.getAttribute("href")) ?? "").hostname).toBe("example.invalid");
  }
  expect(apiRequests).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/(?:^|;\s*)vera/i);
});
