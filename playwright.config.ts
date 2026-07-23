import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const port = 3000;
const baseURL = "http://127.0.0.1:" + String(port);
const e2eDataDirectory = join(process.cwd(), "test-results", "vera-e2e-data");
const nodeExecutable = JSON.stringify(process.execPath);
const tsxExecutable = JSON.stringify(join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"));
const runTypeScript = (script: string) => `${nodeExecutable} ${tsxExecutable} ${script}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // These flows intentionally mutate one seeded SQLite fixture. Retrying against the same
  // server would test contaminated state rather than the failed attempt.
  retries: 0,
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
    command: [
      runTypeScript("scripts/demo-reset.ts"),
      runTypeScript("scripts/demo-seed.ts"),
      runTypeScript("scripts/demo-start.ts")
    ].join(" && "),
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      VERA_DEMO_DATA_DIR: e2eDataDirectory,
      VERA_PUBLIC_BASE_URL: baseURL
    },
    url: baseURL + "/api/health",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
