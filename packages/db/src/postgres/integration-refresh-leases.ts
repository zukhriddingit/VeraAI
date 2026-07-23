import {
  IntegrationIdSchema,
  IsoDateTimeSchema,
  VeraUserIdSchema,
  type VeraUserId
} from "@vera/domain";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AsyncRepository, IntegrationRefreshLeaseRepository } from "../repositories.ts";
import { mapPostgresError } from "./errors.ts";
import type { PostgresExecutor } from "./types.ts";

const LeaseOwnerSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/u);

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

export function createPostgresIntegrationRefreshLeaseRepository(
  db: PostgresExecutor,
  userIdInput: VeraUserId
): AsyncRepository<IntegrationRefreshLeaseRepository> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  return {
    async tryAcquire(input) {
      const integrationId = IntegrationIdSchema.parse(input.integrationId);
      const leaseOwner = LeaseOwnerSchema.parse(input.leaseOwner);
      const now = IsoDateTimeSchema.parse(input.now);
      const leaseExpiresAt = IsoDateTimeSchema.parse(input.leaseExpiresAt);
      if (Date.parse(leaseExpiresAt) <= Date.parse(now)) {
        throw new TypeError("Integration refresh lease expiry must be after acquisition time.");
      }
      const result = await operation(() =>
        db.execute<{ lease_owner: string }>(sql`
          insert into integration_refresh_leases (
            user_id, integration_id, lease_owner, lease_expires_at, created_at, updated_at
          ) values (
            ${userId}::uuid, ${integrationId}::uuid, ${leaseOwner},
            ${leaseExpiresAt}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
          )
          on conflict (user_id, integration_id) do update set
            lease_owner = excluded.lease_owner,
            lease_expires_at = excluded.lease_expires_at,
            updated_at = excluded.updated_at
          where integration_refresh_leases.lease_expires_at <= excluded.updated_at
          returning lease_owner
        `)
      );
      return result.rows[0]?.lease_owner === leaseOwner;
    },
    async release(input) {
      const integrationId = IntegrationIdSchema.parse(input.integrationId);
      const leaseOwner = LeaseOwnerSchema.parse(input.leaseOwner);
      const result = await operation(() =>
        db.execute<{ lease_owner: string }>(sql`
          delete from integration_refresh_leases
          where user_id = ${userId}::uuid
            and integration_id = ${integrationId}::uuid
            and lease_owner = ${leaseOwner}
          returning lease_owner
        `)
      );
      return result.rows[0]?.lease_owner === leaseOwner;
    }
  };
}
