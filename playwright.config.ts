import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const port = 3000;
const baseURL = "http://127.0.0.1:" + String(port);
const e2eDataDirectory = join(process.cwd(), "test-results", "vera-e2e-data");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command:
      "node --import tsx tests/e2e/reset-data.ts && pnpm db:migrate && pnpm db:seed && pnpm --filter @vera/web build && pnpm serve:e2e",
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      VERA_DATA_DIR: e2eDataDirectory,
      VERA_DEMO_MODE: "1"
    },
    url: baseURL + "/api/health",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
