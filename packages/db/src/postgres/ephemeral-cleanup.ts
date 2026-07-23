import { IsoDateTimeSchema } from "@vera/domain";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { EphemeralCleanupResult, SystemEphemeralCleanupRepository } from "../repositories.ts";
import type { PostgresConnection } from "./connection.ts";
import { mapPostgresError } from "./errors.ts";

const BatchSizeSchema = z.number().int().min(1).max(1_000);

function affected(result: { readonly rowCount?: number | null }): number {
  return result.rowCount ?? 0;
}

export function createPostgresEphemeralCleanupRepository(
  connection: PostgresConnection
): SystemEphemeralCleanupRepository {
  return {
    async cleanup(input): Promise<EphemeralCleanupResult> {
      const now = IsoDateTimeSchema.parse(input.now);
      const batchSize = BatchSizeSchema.parse(input.batchSize);
      const oauthCutoff = new Date(Date.parse(now) - 24 * 60 * 60 * 1_000).toISOString();
      const heartbeatCutoff = new Date(Date.parse(now) - 7 * 24 * 60 * 60 * 1_000).toISOString();
      const scheduleRunCutoff = new Date(Date.parse(now) - 30 * 24 * 60 * 60 * 1_000).toISOString();
      try {
        return await connection.db.transaction(async (transaction) => {
          const oauth = await transaction.execute(sql`
            with candidates as (
              select ctid
              from gmail_oauth_states
              where expires_at < ${oauthCutoff}::timestamptz
              order by expires_at, user_id, id
              limit ${batchSize}
              for update skip locked
            )
            delete from gmail_oauth_states as target
            using candidates
            where target.ctid = candidates.ctid
          `);
          const dispatches = await transaction.execute(sql`
            with candidates as (
              select ctid
              from maritime_dispatches
              where state in ('pending_wake', 'accepted')
                and expires_at <= ${now}::timestamptz
              order by expires_at, user_id, id
              limit ${batchSize}
              for update skip locked
            )
            update maritime_dispatches as target
            set state = 'expired', updated_at = ${now}::timestamptz
            from candidates
            where target.ctid = candidates.ctid
          `);
          const heartbeats = await transaction.execute(sql`
            with candidates as (
              select ctid
              from service_heartbeats
              where expires_at < ${heartbeatCutoff}::timestamptz
              order by expires_at, id
              limit ${batchSize}
              for update skip locked
            )
            delete from service_heartbeats as target
            using candidates
            where target.ctid = candidates.ctid
          `);
          const scheduleRuns = await transaction.execute(sql`
            with candidates as (
              select ctid
              from production_schedule_runs
              where state in ('completed', 'permanently_failed', 'cancelled_by_policy')
                and completed_at < ${scheduleRunCutoff}::timestamptz
              order by completed_at, user_id, id
              limit ${batchSize}
              for update skip locked
            )
            delete from production_schedule_runs as target
            using candidates
            where target.ctid = candidates.ctid
          `);
          return {
            gmailOauthStatesDeleted: affected(oauth),
            dispatchesExpired: affected(dispatches),
            heartbeatsDeleted: affected(heartbeats),
            scheduleRunsDeleted: affected(scheduleRuns)
          };
        });
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    }
  };
}
