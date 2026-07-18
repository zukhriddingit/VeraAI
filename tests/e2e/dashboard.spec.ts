import { expect, test } from "@playwright/test";

test("dashboard identifies the isolated sanitized demo", async ({ page, request }) => {
  const healthResponse = await request.get("/api/health");
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "vera-web",
    status: "ok"
  });

  await page.goto("/");

  await expect(page.locator(".demo-banner")).toContainText(
    "Demo mode — sanitized fixture data; no live marketplace accounts connected."
  );
  await expect(page.getByRole("heading", { name: "Harbor City September Search" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "See what Vera finds." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo search" })).toBeEnabled();
  await expect(page.getByText("This offline demo uses sanitized fixtures only.")).toBeVisible();
});
