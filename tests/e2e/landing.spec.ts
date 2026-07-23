import { expect, test } from "@playwright/test";

test("public landing page presents the atlas promise without loading the cockpit", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Find a great home faster." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore the live demo" }).first()).toHaveAttribute(
    "href",
    "https://vera-production-f19c.up.railway.app/"
  );
  await expect(page.getByTestId("atlas-globe")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Many sources. One search you control." })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From the right home to the right move." })
  ).toBeVisible();
  await expect(page.getByText("No autonomous outreach.")).toBeVisible();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
});

test("desktop proof card preserves the globe target", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const proof = await page.getByTestId("hero-proof-card").boundingBox();
  const target = await page.getByTestId("atlas-target").boundingBox();
  expect(proof).not.toBeNull();
  expect(target).not.toBeNull();
  expect(proof!.width).toBeLessThanOrEqual(520);

  const overlapsTarget =
    proof!.x < target!.x + target!.width &&
    proof!.x + proof!.width > target!.x &&
    proof!.y < target!.y + target!.height &&
    proof!.y + proof!.height > target!.y;
  expect(overlapsTarget).toBe(false);
});

test("mobile proof follows the globe and reduced motion is static", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const globe = await page.getByTestId("atlas-globe").boundingBox();
  const proof = await page.getByTestId("hero-proof-card").boundingBox();
  expect(globe).not.toBeNull();
  expect(proof).not.toBeNull();
  expect(proof!.y).toBeGreaterThanOrEqual(globe!.y + globe!.height);

  await expect(page.getByTestId("atlas-signal").first()).toHaveCSS("animation-name", "none");
});
