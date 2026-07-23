import { expect, test } from "@playwright/test";

test("browser-agent settings expose the experimental boundary without live capability", async ({
  page
}) => {
  await page.goto("/settings/integrations/browser-agent");

  await expect(
    page.getByRole("heading", { name: "Capture one page you already opened." })
  ).toBeVisible();
  await expect(page.getByText("Unsupported · experimental personal")).toBeVisible();
  await expect(page.getByText("Disabled by policy")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture current tab" })).toBeDisabled();
  await expect(
    page.getByText(/requests no navigation, messaging, application, payment, or blocker-bypass/iu)
  ).toBeVisible();
});
