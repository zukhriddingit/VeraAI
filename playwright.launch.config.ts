import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/launch",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    {
      name: "marketing",
      testMatch: /marketing\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3001" }
    },
    {
      name: "public-demo",
      testMatch: /public-demo\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3012" }
    }
  ],
  webServer: [
    {
      command: "pnpm --filter @vera/marketing run dev",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_TELEMETRY_DISABLED: "1" }
    },
    {
      command: "pnpm --filter @vera/web exec next dev --hostname 127.0.0.1 --port 3012",
      url: "http://127.0.0.1:3012/demo",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_TELEMETRY_DISABLED: "1" }
    }
  ]
});
