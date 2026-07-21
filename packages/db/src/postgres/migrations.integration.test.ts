import { describe, expect, it } from "vitest";

import { checkPostgresReadiness } from "./migrations.ts";
import { withPostgresTestDatabase } from "./testing.ts";

describe("PostgreSQL migration readiness", () => {
  it("reports ready only when the expected migration hash is present", async () => {
    await withPostgresTestDatabase(async ({ connection, schemaName }) => {
      await expect(
        checkPostgresReadiness(connection, {
          service: "vera-web",
          now: () => new Date("2026-07-20T12:00:00.000Z"),
          migrationsSchema: schemaName
        })
      ).resolves.toEqual({
        service: "vera-web",
        status: "ready",
        checkedAt: "2026-07-20T12:00:00.000Z",
        database: { status: "ready", migration: "current" }
      });
    });
  });

  it("rejects an arbitrary migration schema", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      await expect(
        checkPostgresReadiness(connection, {
          service: "vera-web",
          migrationsSchema: "drizzle; drop schema public"
        })
      ).rejects.toThrow("migration schema name is invalid");
    });
  });
});
