import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SOURCE_POLICY_MANIFEST_FIXTURES } from "../fixtures.ts";
import { createPostgresGlobalPolicyRepository } from "./policy-repository.ts";
import {
  activityEvents,
  canonicalListings,
  integrationConnections,
  rawListings,
  searchProfiles,
  sourceJobs,
  users
} from "./schema.ts";
import { seedPostgresGlobalPolicy } from "./seed.ts";
import { withPostgresTestDatabase } from "./testing.ts";

describe("PostgreSQL global policy seed", () => {
  it("is idempotent and never creates private data", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedPostgresGlobalPolicy(connection);
      await seedPostgresGlobalPolicy(connection);

      const policies = await createPostgresGlobalPolicyRepository(db).list();
      expect(policies).toEqual(
        [...SOURCE_POLICY_MANIFEST_FIXTURES].sort((left, right) =>
          left.connectorId.localeCompare(right.connectorId)
        )
      );

      for (const table of [
        users,
        integrationConnections,
        searchProfiles,
        rawListings,
        canonicalListings,
        sourceJobs,
        activityEvents
      ]) {
        const rows = await db.select({ value: count() }).from(table);
        expect(Number(rows[0]?.value ?? -1)).toBe(0);
      }
    });
  });
});
