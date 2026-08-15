import { expect, test } from "@playwright/test";

test("browser-agent settings expose the experimental boundary without live capability", async ({
  page
}) => {
  await page.goto("/settings/integrations/browser-agent");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Connect once. Share one tab only when you search."
    })
  ).toBeVisible();
  await expect(page.getByText("Private beta · experimental personal")).toBeVisible();
  await expect(page.getByText("Assignment service unavailable")).toBeVisible();
  await expect(
    page.getByText("Install or update version 2.2.0 in this Chrome profile, then return here.")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Install Browser Connector" })).toBeDisabled();
  await expect(page.getByText("Disabled by policy")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture current tab" })).toBeDisabled();
  await expect(
    page.getByText(
      /never automates sign-in, CAPTCHA, contact, applications, payments, uploads, downloads, or blocker bypasses/iu
    )
  ).toBeVisible();
});
