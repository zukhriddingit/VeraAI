import { defineConfig } from "vitest/config";

const sharedExclusions = ["**/.next/**", "**/dist/**", "**/node_modules/**", "**/tests/e2e/**"];

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["**/*.unit.test.ts"],
          exclude: sharedExclusions
        }
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["**/*.integration.test.ts"],
          exclude: sharedExclusions
        }
      }
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage"
    }
  }
});
