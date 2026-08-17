import { expect, test } from "@playwright/test";

test("marketing uses canonical launch links and accessible section navigation", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Find a great home faster." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore demo" }).first()).toHaveAttribute(
    "href",
    "https://app.verahousing.app/demo"
  );
  await expect(page.getByRole("link", { name: "Join private beta" }).first()).toHaveAttribute(
    "href",
    "https://app.verahousing.app/beta"
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "https://app.verahousing.app/sign-in"
  );

  await page.getByRole("link", { name: "Product", exact: true }).click();
  await expect(page).toHaveURL(/#evidence$/);
  await expect(page.getByRole("heading", { name: "Know why this home stands out." })).toBeFocused();
});

test("marketing respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator("[data-reveal]").first()).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-reveal]").first()).toHaveCSS("transform", "none");
});

test("marketing mobile header remains deliberate", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Vera home" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Join private beta" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Product", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Find a great home faster." })).toBeVisible();
});

test("privacy notices describe self-service controls and bounded browser revocation", async ({
  page
}) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Your choices" })).toBeVisible();
  await expect(page.getByText("Settings → Privacy")).toBeVisible();
  await expect(page.getByText("support@verahousing.app")).toHaveAttribute(
    "href",
    "mailto:support@verahousing.app"
  );

  await page.goto("/privacy/browser-connector");
  await expect(page.getByText(/server-side Browser Connector assignment/)).toBeVisible();
  await expect(page.getByText(/Managed backups age out/)).toBeVisible();
  await expect(page.getByText(/Limited Use requirements/)).toBeVisible();
});
