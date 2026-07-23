import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresRepositoryProvider } from "./repositories.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc";
const OTHER_USER_ID = "028f9f64-7b5a-7c91-a12e-123456789abc";
const INTEGRATION_ID = "138f9f64-7b5a-7c91-a12e-123456789abc";
const NOW = "2026-07-22T12:00:00.000Z";

describe("PostgreSQL integration refresh leases", () => {
  it("allows one refresh owner and recovers after expiry", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.execute(sql`
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values
          (${USER_ID}::uuid, 'Founder', 'founder@example.test', true, ${NOW}::timestamptz, ${NOW}::timestamptz),
          (${OTHER_USER_ID}::uuid, 'Other', 'other@example.test', true, ${NOW}::timestamptz, ${NOW}::timestamptz)
      `);
      await db.execute(sql`
        insert into integration_connections (
          user_id, id, provider, provider_subject_id, granted_scopes, status, created_at, updated_at
        ) values (
          ${USER_ID}::uuid, ${INTEGRATION_ID}::uuid, 'google', 'google-subject-1',
          ARRAY[]::text[], 'partial', ${NOW}::timestamptz, ${NOW}::timestamptz
        )
      `);
      const provider = createPostgresRepositoryProvider(connection);
      const first = provider.forUser(USER_ID).integrationRefreshLeases;
      const second = provider.forUser(USER_ID).integrationRefreshLeases;
      const input = {
        integrationId: INTEGRATION_ID,
        now: NOW,
        leaseExpiresAt: "2026-07-22T12:00:30.000Z"
      };

      const results = await Promise.all([
        first.tryAcquire({ ...input, leaseOwner: "web-a" }),
        second.tryAcquire({ ...input, leaseOwner: "worker-b" })
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const winningOwner = results[0] ? "web-a" : "worker-b";
      const losingOwner = results[0] ? "worker-b" : "web-a";
      await expect(
        first.release({ integrationId: INTEGRATION_ID, leaseOwner: losingOwner })
      ).resolves.toBe(false);
      await expect(
        provider.forUser(OTHER_USER_ID).integrationRefreshLeases.release({
          integrationId: INTEGRATION_ID,
          leaseOwner: winningOwner
        })
      ).resolves.toBe(false);
      await expect(
        first.tryAcquire({
          integrationId: INTEGRATION_ID,
          now: "2026-07-22T12:00:31.000Z",
          leaseExpiresAt: "2026-07-22T12:01:01.000Z",
          leaseOwner: "web-c"
        })
      ).resolves.toBe(true);
      await expect(
        first.release({ integrationId: INTEGRATION_ID, leaseOwner: "web-c" })
      ).resolves.toBe(true);
    });
  });

  it("enforces tenant ownership and cascades when the integration is deleted", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.execute(sql`
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values
          (${USER_ID}::uuid, 'Founder', 'founder@example.test', true, ${NOW}::timestamptz, ${NOW}::timestamptz),
          (${OTHER_USER_ID}::uuid, 'Other', 'other@example.test', true, ${NOW}::timestamptz, ${NOW}::timestamptz)
      `);
      await db.execute(sql`
        insert into integration_connections (
          user_id, id, provider, provider_subject_id, granted_scopes, status, created_at, updated_at
        ) values (
          ${USER_ID}::uuid, ${INTEGRATION_ID}::uuid, 'google', 'google-subject-1',
          ARRAY[]::text[], 'partial', ${NOW}::timestamptz, ${NOW}::timestamptz
        )
      `);
      const provider = createPostgresRepositoryProvider(connection);
      await expect(
        provider.forUser(OTHER_USER_ID).integrationRefreshLeases.tryAcquire({
          integrationId: INTEGRATION_ID,
          leaseOwner: "other-user",
          now: NOW,
          leaseExpiresAt: "2026-07-22T12:00:30.000Z"
        })
      ).rejects.toMatchObject({ category: "ownership_violation" });

      await expect(
        provider.forUser(USER_ID).integrationRefreshLeases.tryAcquire({
          integrationId: INTEGRATION_ID,
          leaseOwner: "web-a",
          now: NOW,
          leaseExpiresAt: "2026-07-22T12:00:30.000Z"
        })
      ).resolves.toBe(true);
      await db.execute(sql`
        delete from integration_connections
        where user_id = ${USER_ID}::uuid and id = ${INTEGRATION_ID}::uuid
      `);
      const count = await db.execute<{ count: number }>(sql`
        select count(*)::int as count from integration_refresh_leases
      `);
      expect(count.rows).toEqual([{ count: 0 }]);
    });
  });
});
