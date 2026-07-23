import { defineConfig } from "vitest/config";

const sharedExclusions = [
  "**/.next/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/tests/e2e/**",
  "**/src/postgres/**/*.integration.test.ts"
];

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
      },
      {
        test: {
          name: "postgres-integration",
          environment: "node",
          include: ["**/src/postgres/**/*.integration.test.ts"],
          exclude: ["**/.next/**", "**/dist/**", "**/node_modules/**"],
          // Every file creates and migrates an isolated schema. Serializing files keeps
          // lock usage representative of the founder-size PostgreSQL deployment.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000
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
