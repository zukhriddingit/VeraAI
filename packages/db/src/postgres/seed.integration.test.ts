import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { SOURCE_POLICY_MANIFEST_FIXTURES } from "../fixtures.ts";
import { createPostgresGlobalPolicyRepository } from "./policy-repository.ts";
import { HOSTED_SOURCE_POLICY_MANIFESTS, seedPostgresGlobalPolicy } from "./seed.ts";
import { withPostgresTestDatabase } from "./testing.ts";

interface PrivateCounts extends Record<string, unknown> {
  readonly users: number;
  readonly search_profiles: number;
  readonly raw_listings: number;
  readonly listing_source_records: number;
  readonly canonical_listings: number;
  readonly source_jobs: number;
  readonly activity_events: number;
  readonly integration_connections: number;
  readonly web_push_subscriptions: number;
  readonly notification_deliveries: number;
}

async function privateTableCounts(
  db: Parameters<Parameters<typeof withPostgresTestDatabase>[0]>[0]["db"]
): Promise<PrivateCounts> {
  const result = await db.execute<PrivateCounts>(sql`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from search_profiles) as search_profiles,
      (select count(*)::int from raw_listings) as raw_listings,
      (select count(*)::int from listing_source_records) as listing_source_records,
      (select count(*)::int from canonical_listings) as canonical_listings,
      (select count(*)::int from source_jobs) as source_jobs,
      (select count(*)::int from activity_events) as activity_events,
      (select count(*)::int from integration_connections) as integration_connections,
      (select count(*)::int from web_push_subscriptions) as web_push_subscriptions,
      (select count(*)::int from notification_deliveries) as notification_deliveries
  `);
  const counts = result.rows[0];
  if (!counts) throw new Error("Private table count query returned no row.");
  return counts;
}

describe("PostgreSQL global policy seed", () => {
  it("is idempotent and never creates private data", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      const before = await privateTableCounts(db);
      const first = await seedPostgresGlobalPolicy(connection);
      const second = await seedPostgresGlobalPolicy(connection);
      const after = await privateTableCounts(db);

      expect(first).toEqual({
        sourcePolicyManifests: HOSTED_SOURCE_POLICY_MANIFESTS.length,
        inserted: HOSTED_SOURCE_POLICY_MANIFESTS.length
      });
      expect(second).toEqual({
        sourcePolicyManifests: HOSTED_SOURCE_POLICY_MANIFESTS.length,
        inserted: 0
      });
      expect(after).toEqual(before);

      const policies = await createPostgresGlobalPolicyRepository(db).list();
      expect(policies).toEqual(
        [...HOSTED_SOURCE_POLICY_MANIFESTS].sort((left, right) =>
          left.connectorId.localeCompare(right.connectorId)
        )
      );
      expect(policies.every((policy) => policy.acquisitionMode !== "fixture")).toBe(true);
      expect(
        SOURCE_POLICY_MANIFEST_FIXTURES.some((policy) => policy.acquisitionMode === "fixture")
      ).toBe(true);
    });
  });
});
