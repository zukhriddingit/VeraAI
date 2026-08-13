import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresRepositoryProvider } from "./repositories.ts";
import { withPostgresTestDatabase, type PostgresTestContext } from "./testing.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
const sourceRecordId = "source-disposition-1";
const observedAt = "2026-08-13T12:00:00.000Z";

async function seedSource(db: PostgresTestContext["db"]): Promise<void> {
  await db.execute(sql`
    insert into users (id, name, email, email_verified, created_at, updated_at)
    values (${userId}::uuid, 'Disposition User', 'disposition@example.test', true,
      ${observedAt}::timestamptz, ${observedAt}::timestamptz)
  `);
  await db.execute(sql`
    insert into raw_listings (
      user_id, id, source, acquisition_mode, capture_method, observed_at,
      raw_text, capture_metadata, content_hash, idempotency_key, created_at
    ) values (
      ${userId}::uuid, 'raw-disposition-1', 'apartments', 'local_browser',
      'local_browser', ${observedAt}::timestamptz, 'Observed navigation card',
      '{}'::jsonb, ${"a".repeat(64)}, ${"b".repeat(64)}, ${observedAt}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into listing_source_records (
      user_id, id, raw_listing_id, source, source_url, contact_channel, title,
      amenities, extraction_confidence_basis_points, completeness_basis_points,
      observed_at, created_at
    ) values (
      ${userId}::uuid, ${sourceRecordId}, 'raw-disposition-1', 'apartments',
      'https://www.apartments.com/boston-ma/parking/', 'unknown', 'Parking',
      '[]'::jsonb, 10000, 1000, ${observedAt}::timestamptz, ${observedAt}::timestamptz
    )
  `);
}

describe("PostgreSQL source-record dispositions", () => {
  it("defaults to accepted and changes current state only through append-only events", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedSource(db);
      const repository =
        createPostgresRepositoryProvider(connection).forUser(userId).sourceRecordDispositions;

      await expect(repository.getCurrent(sourceRecordId)).resolves.toBeNull();
      await expect(repository.isEligible(sourceRecordId)).resolves.toBe(true);

      const invalid = {
        id: "disposition-invalid-1",
        listingSourceRecordId: sourceRecordId,
        disposition: "invalid_non_listing" as const,
        reasonCode: "apartments_navigation_url",
        evidence: { observedUrl: "https://www.apartments.com/boston-ma/parking/" },
        payloadHash: "c".repeat(64),
        actor: "founder" as const,
        observedAt
      };
      await expect(repository.append(invalid)).resolves.toMatchObject({ inserted: true });
      await expect(repository.append({ ...invalid, id: "ignored-duplicate-id" })).resolves.toEqual({
        event: invalid,
        inserted: false
      });
      await expect(repository.isEligible(sourceRecordId)).resolves.toBe(false);

      await expect(
        db.execute(sql`
          update listing_source_record_dispositions set reason_code = 'mutated'
          where user_id = ${userId}::uuid and id = ${invalid.id}
        `)
      ).rejects.toBeDefined();
      await expect(
        db.execute(sql`
          delete from listing_source_record_dispositions
          where user_id = ${userId}::uuid and id = ${invalid.id}
        `)
      ).rejects.toBeDefined();
      await expect(repository.getCurrent(sourceRecordId)).resolves.toEqual(invalid);

      const accepted = {
        ...invalid,
        id: "disposition-accepted-1",
        disposition: "accepted" as const,
        reasonCode: "founder_reversal",
        payloadHash: "d".repeat(64),
        observedAt: "2026-08-13T12:01:00.000Z"
      };
      await expect(repository.append(accepted)).resolves.toMatchObject({ inserted: true });
      await expect(repository.getCurrent(sourceRecordId)).resolves.toEqual(accepted);
      await expect(repository.listCurrent()).resolves.toEqual([accepted]);
      await expect(repository.isEligible(sourceRecordId)).resolves.toBe(true);
    });
  });
});
