import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresEphemeralCleanupRepository } from "./ephemeral-cleanup.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc";
const NOW = "2026-08-31T12:00:00.000Z";
const HASH = "a".repeat(64);

async function seedCleanupGraph(
  db: Parameters<Parameters<typeof withPostgresTestDatabase>[0]>[0]["db"]
) {
  await db.execute(sql`
    insert into users (id, name, email, email_verified, created_at, updated_at)
    values (${USER_ID}::uuid, 'Founder', 'founder@example.test', true,
      '2026-06-01T12:00:00.000Z'::timestamptz, '2026-06-01T12:00:00.000Z'::timestamptz)
  `);
  await db.execute(sql`
    insert into gmail_oauth_states (
      user_id, id, state_hash, code_verifier_hash, redirect_path, requested_scopes,
      created_at, expires_at, consumed_at
    ) values
      (${USER_ID}::uuid, 'oauth-old-a', ${"1".repeat(64)}, ${"2".repeat(64)},
        '/settings/integrations', ARRAY['https://www.googleapis.com/auth/gmail.readonly']::text[],
        '2026-08-28T10:00:00.000Z'::timestamptz, '2026-08-28T10:10:00.000Z'::timestamptz,
        '2026-08-28T10:05:00.000Z'::timestamptz),
      (${USER_ID}::uuid, 'oauth-old-b', ${"3".repeat(64)}, ${"4".repeat(64)},
        '/settings/integrations', ARRAY['https://www.googleapis.com/auth/gmail.readonly']::text[],
        '2026-08-29T10:00:00.000Z'::timestamptz, '2026-08-29T10:10:00.000Z'::timestamptz, null),
      (${USER_ID}::uuid, 'oauth-recent', ${"5".repeat(64)}, ${"6".repeat(64)},
        '/settings/integrations', ARRAY['https://www.googleapis.com/auth/gmail.readonly']::text[],
        '2026-08-31T10:00:00.000Z'::timestamptz, '2026-08-31T10:10:00.000Z'::timestamptz, null)
  `);
  await db.execute(sql`
    insert into raw_listings (
      user_id, id, source, acquisition_mode, capture_method, observed_at, raw_text,
      capture_metadata, content_hash, idempotency_key, created_at
    ) values (
      ${USER_ID}::uuid, 'raw-preserved', 'other', 'fixture', 'fixture',
      '2026-06-01T12:00:00.000Z'::timestamptz, 'Sanitized evidence', '{}'::jsonb,
      ${"7".repeat(64)}, 'cleanup-preserved', '2026-06-01T12:00:00.000Z'::timestamptz
    )
  `);
  await db.execute(sql`
    insert into activity_events (
      user_id, id, correlation_id, actor, action, target_type, target_id,
      policy_decision, payload_hash, outcome, metadata, occurred_at
    ) values (
      ${USER_ID}::uuid, 'audit-preserved', 'cleanup-correlation', 'system',
      'cleanup.fixture.created', 'system', 'cleanup', 'not_applicable', ${HASH},
      'recorded', '{}'::jsonb, '2026-06-01T12:00:00.000Z'::timestamptz
    )
  `);
  await db.execute(sql`
    insert into source_jobs (
      user_id, id, correlation_id, connector_id, source, acquisition_mode,
      manifest_version, trigger, capability, operation, payload, payload_hash,
      idempotency_key, status, attempts, max_attempts, available_at, created_at, updated_at
    ) values (
      ${USER_ID}::uuid, 'job-cleanup', 'cleanup-correlation', 'fixture.connector', 'other',
      'fixture', 1, 'scheduled', 'fixture.read', 'discover', '{}'::jsonb, ${HASH},
      ${"b".repeat(64)}, 'queued', 0, 3, '2026-06-01T12:00:00.000Z'::timestamptz,
      '2026-06-01T12:00:00.000Z'::timestamptz, '2026-06-01T12:00:00.000Z'::timestamptz
    )
  `);
  await db.execute(sql`
    insert into maritime_dispatches (
      user_id, id, source_job_id, issuer, audience, nonce_hash, payload_hash, state,
      maritime_agent_id, issued_at, expires_at, created_at, updated_at
    ) values
      (${USER_ID}::uuid, 'dispatch-old', 'job-cleanup', 'vera-control-plane', 'worker-a',
        ${"c".repeat(64)}, ${HASH}, 'pending_wake', 'worker-a',
        '2026-08-31T10:00:00.000Z'::timestamptz, '2026-08-31T10:05:00.000Z'::timestamptz,
        '2026-08-31T10:00:00.000Z'::timestamptz, '2026-08-31T10:00:00.000Z'::timestamptz),
      (${USER_ID}::uuid, 'dispatch-future', 'job-cleanup', 'vera-control-plane', 'worker-a',
        ${"d".repeat(64)}, ${HASH}, 'pending_wake', 'worker-a',
        '2026-08-31T11:55:00.000Z'::timestamptz, '2026-08-31T12:05:00.000Z'::timestamptz,
        '2026-08-31T11:55:00.000Z'::timestamptz, '2026-08-31T11:55:00.000Z'::timestamptz)
  `);
  await db.execute(sql`
    insert into service_heartbeats (
      id, service, deployment_id, status, version, checked_at, expires_at
    ) values
      ('heartbeat-old', 'vera-worker', 'worker-old', 'ready', '1.0.0',
        '2026-08-20T10:00:00.000Z'::timestamptz, '2026-08-20T10:05:00.000Z'::timestamptz),
      ('heartbeat-recent', 'vera-worker', 'worker-recent', 'ready', '1.0.0',
        '2026-08-30T10:00:00.000Z'::timestamptz, '2026-08-30T10:05:00.000Z'::timestamptz)
  `);
  await db.execute(sql`
    insert into production_schedules (
      user_id, id, kind, state, interval_seconds, source_configuration_id,
      next_run_at, created_at, updated_at
    ) values (
      ${USER_ID}::uuid, 'schedule-cleanup', 'ephemeral_cleanup', 'enabled', 86400, null,
      ${NOW}::timestamptz, '2026-06-01T12:00:00.000Z'::timestamptz,
      '2026-06-01T12:00:00.000Z'::timestamptz
    )
  `);
  await db.execute(sql`
    insert into production_schedule_runs (
      user_id, id, schedule_id, state, due_at, idempotency_key, attempt_count,
      started_at, completed_at, created_at, updated_at
    ) values
      (${USER_ID}::uuid, 'run-old', 'schedule-cleanup', 'completed',
        '2026-07-01T12:00:00.000Z'::timestamptz, ${"e".repeat(64)}, 1,
        '2026-07-01T12:00:00.000Z'::timestamptz, '2026-07-01T12:01:00.000Z'::timestamptz,
        '2026-07-01T12:00:00.000Z'::timestamptz, '2026-07-01T12:01:00.000Z'::timestamptz),
      (${USER_ID}::uuid, 'run-recent', 'schedule-cleanup', 'completed',
        '2026-08-15T12:00:00.000Z'::timestamptz, ${"f".repeat(64)}, 1,
        '2026-08-15T12:00:00.000Z'::timestamptz, '2026-08-15T12:01:00.000Z'::timestamptz,
        '2026-08-15T12:00:00.000Z'::timestamptz, '2026-08-15T12:01:00.000Z'::timestamptz)
  `);
}

describe("PostgreSQL ephemeral cleanup", () => {
  it("cleans only expired control rows in bounded batches and preserves durable evidence", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await seedCleanupGraph(db);
      const cleanup = createPostgresEphemeralCleanupRepository(connection);

      await expect(cleanup.cleanup({ now: NOW, batchSize: 1 })).resolves.toEqual({
        gmailOauthStatesDeleted: 1,
        dispatchesExpired: 1,
        heartbeatsDeleted: 1,
        scheduleRunsDeleted: 1
      });
      await expect(cleanup.cleanup({ now: NOW, batchSize: 1 })).resolves.toEqual({
        gmailOauthStatesDeleted: 1,
        dispatchesExpired: 0,
        heartbeatsDeleted: 0,
        scheduleRunsDeleted: 0
      });
      await expect(cleanup.cleanup({ now: NOW, batchSize: 1 })).resolves.toEqual({
        gmailOauthStatesDeleted: 0,
        dispatchesExpired: 0,
        heartbeatsDeleted: 0,
        scheduleRunsDeleted: 0
      });

      const state = await db.execute<Record<string, number>>(sql`
        select
          (select count(*)::int from raw_listings where id = 'raw-preserved') as raw_listings,
          (select count(*)::int from activity_events where id = 'audit-preserved') as activity_events,
          (select count(*)::int from source_jobs where id = 'job-cleanup') as source_jobs,
          (select count(*)::int from gmail_oauth_states where id = 'oauth-recent') as recent_oauth,
          (select count(*)::int from maritime_dispatches where id = 'dispatch-future' and state = 'pending_wake') as future_dispatch,
          (select count(*)::int from maritime_dispatches where id = 'dispatch-old' and state = 'expired') as expired_dispatch,
          (select count(*)::int from service_heartbeats where id = 'heartbeat-recent') as recent_heartbeat,
          (select count(*)::int from production_schedule_runs where id = 'run-recent') as recent_run
      `);
      expect(state.rows[0]).toEqual({
        raw_listings: 1,
        activity_events: 1,
        source_jobs: 1,
        recent_oauth: 1,
        future_dispatch: 1,
        expired_dispatch: 1,
        recent_heartbeat: 1,
        recent_run: 1
      });
    });
  });
});
