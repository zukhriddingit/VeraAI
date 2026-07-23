import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { withPostgresTestDatabase, type PostgresTestContext } from "./testing.ts";

const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
const otherUserId = "028f9f64-7b5a-7c91-a12e-123456789abc";
const integrationId = "138f9f64-7b5a-7c91-a12e-123456789abc";
const now = "2026-07-21T12:00:00.000Z";
const hash = "a".repeat(64);

async function seedCalendarGraph(db: PostgresTestContext["db"]): Promise<void> {
  await db.execute(sql`
    insert into users (id, name, email, email_verified, created_at, updated_at)
    values
      (${userId}::uuid, 'Calendar User', 'calendar@example.test', true, ${now}::timestamptz, ${now}::timestamptz),
      (${otherUserId}::uuid, 'Other User', 'other@example.test', true, ${now}::timestamptz, ${now}::timestamptz)
  `);
  await db.execute(sql`
    insert into integration_connections (
      user_id, id, provider, provider_subject_id, granted_scopes, status, created_at, updated_at
    ) values (
      ${userId}::uuid, ${integrationId}::uuid, 'google', 'google-subject-1',
      ARRAY['https://www.googleapis.com/auth/calendar.freebusy']::text[],
      'partial', ${now}::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into availability_rule_sets (
      user_id, id, time_zone, weekly_intervals, duration_minutes, minimum_notice_minutes,
      travel_minutes, buffer_minutes, reminders_minutes_before_start,
      conflict_checking_enabled, selected_calendar_ids, schema_version, created_at, updated_at
    ) values (
      ${userId}::uuid, 'rules-1', 'America/New_York',
      '{"1":[{"startsAt":"09:00","endsAt":"12:00"}],"2":[],"3":[],"4":[],"5":[],"6":[],"7":[]}'::jsonb,
      60, 120, 20, 10, '[30]'::jsonb, true, '["primary"]'::jsonb, 1,
      ${now}::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into calendar_oauth_states (
      user_id, id, state_hash, capability, requested_calendar_scopes,
      credential_version, credential_algorithm, credential_key_id, credential_nonce,
      credential_ciphertext, credential_authentication_tag, redirect_uri_hash, return_to,
      expires_at, created_at
    ) values (
      ${userId}::uuid, '238f9f64-7b5a-7c91-a12e-123456789abc'::uuid, ${hash},
      'calendar_conflict_checking',
      '["https://www.googleapis.com/auth/calendar.freebusy"]'::jsonb,
      1, 'aes-256-gcm', 'key-v1', decode('001122', 'hex'), decode('334455', 'hex'),
      decode('667788', 'hex'), ${"b".repeat(64)}, '/settings/integrations',
      '2026-07-21T12:10:00.000Z'::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into availability_checks (
      user_id, id, availability_rule_set_id, integration_connection_id, state,
      range_starts_at, range_ends_at, calendar_ids_attempted, calendars_checked,
      checked_at, response_hash, busy_interval_count, safe_provider_error_code,
      correlation_id, created_at
    ) values (
      ${userId}::uuid, 'check-1', 'rules-1', ${integrationId}::uuid, 'checked',
      '2026-07-27T12:00:00.000Z'::timestamptz,
      '2026-07-27T15:00:00.000Z'::timestamptz,
      '["primary"]'::jsonb, '["primary"]'::jsonb, ${now}::timestamptz,
      ${"c".repeat(64)}, 0, null, 'correlation-calendar-1', ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into search_profiles (
      user_id, id, name, version, location_text, pet_requirements, commute_anchors,
      hard_constraints, weighted_preferences, notification_rules, created_at, updated_at
    ) values (
      ${userId}::uuid, 'profile-1', 'Calendar profile', 1, 'Boston, MA',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '{"enabled":false,"minimumScoreBasisPoints":null}'::jsonb,
      ${now}::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into raw_listings (
      user_id, id, source, acquisition_mode, capture_method, observed_at, raw_text,
      capture_metadata, content_hash, idempotency_key, created_at
    ) values (
      ${userId}::uuid, 'raw-calendar-1', 'other', 'fixture', 'fixture', ${now}::timestamptz,
      'Sanitized calendar fixture', '{}'::jsonb, ${"d".repeat(64)},
      'calendar-fixture-1', ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into listing_source_records (
      user_id, id, raw_listing_id, source, contact_channel, title, amenities,
      extraction_confidence_basis_points, completeness_basis_points, observed_at, created_at
    ) values (
      ${userId}::uuid, 'source-calendar-1', 'raw-calendar-1', 'other', 'unknown',
      'Sanitized calendar listing', '[]'::jsonb, 10000, 5000,
      ${now}::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into canonical_listings (
      user_id, id, search_profile_id, primary_source_record_id, title, amenities,
      lifecycle_state, completeness_basis_points, freshest_observed_at, created_at, updated_at
    ) values (
      ${userId}::uuid, 'listing-calendar-1', 'profile-1', 'source-calendar-1',
      'Sanitized calendar listing', '[]'::jsonb, 'tour_proposed', 5000,
      ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into viewings (
      user_id, id, canonical_listing_id, proposed_windows, selected_window,
      confirmed_window, supersedes_viewing_id, time_zone, calendar_reference,
      state, notes, metadata, created_at, updated_at
    ) values (
      ${userId}::uuid, 'viewing-1', 'listing-calendar-1', '[]'::jsonb, null,
      null, null, 'America/New_York', null, 'proposed', null, '{}'::jsonb,
      ${now}::timestamptz, ${now}::timestamptz
    )
  `);
  await db.execute(sql`
    insert into approvals (
      user_id, id, actor, connector_id, operation, target_type, target_id,
      payload_hash, state, created_at, expires_at, used_at
    ) values (
      ${userId}::uuid, 'approval-1', 'user', 'google-calendar', 'calendar.hold.create',
      'calendar_hold', 'hold-1', ${"e".repeat(64)}, 'pending', ${now}::timestamptz,
      '2026-07-21T12:10:00.000Z'::timestamptz, null
    )
  `);
  await db.execute(sql`
    insert into calendar_holds (
      user_id, id, viewing_id, approval_id, availability_check_id, payload_hash,
      idempotency_key, calendar_id, google_event_id, provider_event_reference,
      state, conflict_check_override, conflict_check_override_reason, safe_error_code,
      created_at, updated_at, completed_at
    ) values (
      ${userId}::uuid, 'hold-1', 'viewing-1', 'approval-1', 'check-1',
      ${"e".repeat(64)}, ${"f".repeat(64)}, 'primary', ${`vera${"1".repeat(40)}`},
      null, 'approved', false, null, null, ${now}::timestamptz, ${now}::timestamptz, null
    )
  `);
}

const privateApplicationTables = [
  "activity_events",
  "approvals",
  "availability_checks",
  "availability_rule_sets",
  "browser_nodes",
  "calendar_holds",
  "calendar_oauth_states",
  "canonical_decision_runs",
  "canonical_field_sources",
  "canonical_listing_sources",
  "canonical_listings",
  "contact_workflows",
  "decision_corpus_state",
  "decision_job_attempts",
  "decision_jobs",
  "decision_runs",
  "duplicate_clusters",
  "duplicate_override_revocations",
  "duplicate_overrides",
  "duplicate_pair_evaluations",
  "field_provenance",
  "listing_extractions",
  "listing_photos",
  "listing_scores",
  "listing_source_records",
  "normalization_jobs",
  "raw_listings",
  "risk_signals",
  "search_profiles",
  "source_job_attempts",
  "source_jobs",
  "viewings"
] as const;

describe("PostgreSQL baseline", () => {
  it("migrates all hosted tables and PostgreSQL-native types", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      const columns = await db.execute<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(sql`
        select table_name, column_name, data_type
        from information_schema.columns
        where table_schema = current_schema()
          and (
            (table_name = 'activity_events' and column_name = 'occurred_at')
            or (table_name = 'availability_rule_sets' and column_name = 'weekly_intervals')
            or (table_name = 'availability_checks' and column_name = 'checked_at')
            or (table_name = 'calendar_holds' and column_name = 'user_id')
            or (table_name = 'calendar_oauth_states' and column_name = 'credential_ciphertext')
            or (table_name = 'raw_listings' and column_name = 'raw_json')
            or (table_name = 'search_profiles' and column_name = 'move_in_earliest')
            or (table_name = 'search_profiles' and column_name = 'user_id')
            or (table_name = 'integration_connections' and column_name = 'credential_ciphertext')
          )
        order by table_name, column_name
      `);

      expect(columns.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table_name: "activity_events",
            column_name: "occurred_at",
            data_type: "timestamp with time zone"
          }),
          expect.objectContaining({
            table_name: "availability_rule_sets",
            column_name: "weekly_intervals",
            data_type: "jsonb"
          }),
          expect.objectContaining({
            table_name: "availability_checks",
            column_name: "checked_at",
            data_type: "timestamp with time zone"
          }),
          expect.objectContaining({
            table_name: "calendar_holds",
            column_name: "user_id",
            data_type: "uuid"
          }),
          expect.objectContaining({
            table_name: "calendar_oauth_states",
            column_name: "credential_ciphertext",
            data_type: "bytea"
          }),
          expect.objectContaining({
            table_name: "raw_listings",
            column_name: "raw_json",
            data_type: "jsonb"
          }),
          expect.objectContaining({
            table_name: "search_profiles",
            column_name: "move_in_earliest",
            data_type: "date"
          }),
          expect.objectContaining({
            table_name: "search_profiles",
            column_name: "user_id",
            data_type: "uuid"
          }),
          expect.objectContaining({
            table_name: "integration_connections",
            column_name: "credential_ciphertext",
            data_type: "bytea"
          })
        ])
      );
    });
  });

  it("adds tenant ownership to every private application table", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      const result = await db.execute<{ table_name: string }>(sql`
        select table_name
        from information_schema.columns
        where table_schema = current_schema() and column_name = 'user_id'
      `);
      const owned = new Set(result.rows.map(({ table_name }) => table_name));

      for (const table of privateApplicationTables) {
        expect(owned.has(table), `${table} must carry user_id`).toBe(true);
      }
      expect(owned.has("source_policy_manifests")).toBe(false);
    });
  });

  it("enforces append-only raw evidence in the database", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
      await db.execute(sql`
        insert into users (id, name, email, email_verified)
        values (${userId}::uuid, 'Test User', 'test@example.test', true)
      `);
      await db.execute(sql`
        insert into raw_listings (
          user_id, id, source, acquisition_mode, capture_method, observed_at,
          raw_text, capture_metadata, content_hash, idempotency_key, created_at
        ) values (
          ${userId}::uuid, 'raw-1', 'other', 'fixture', 'fixture', now(),
          'sanitized fixture', '{}'::jsonb, ${"a".repeat(64)}, 'fixture:raw-1', now()
        )
      `);

      await expect(
        db.execute(sql`update raw_listings set raw_text = 'changed' where id = 'raw-1'`)
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "55000" }) });
    });
  });

  it("enforces append-only availability checks and the persisted state matrix", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await seedCalendarGraph(db);

      await expect(
        db.execute(sql`update availability_checks set busy_interval_count = 1 where id = 'check-1'`)
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "55000" }) });
      await expect(
        db.execute(sql`delete from availability_checks where id = 'check-1'`)
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "55000" }) });
      await expect(
        db.execute(sql`
          insert into availability_checks (
            user_id, id, availability_rule_set_id, state, range_starts_at, range_ends_at,
            calendar_ids_attempted, calendars_checked, checked_at, response_hash,
            busy_interval_count, safe_provider_error_code, correlation_id, created_at
          ) values (
            ${userId}::uuid, 'check-invalid-partial', 'rules-1', 'scope_not_granted',
            '2026-07-27T12:00:00.000Z'::timestamptz,
            '2026-07-27T15:00:00.000Z'::timestamptz,
            '[]'::jsonb, '[]'::jsonb, ${now}::timestamptz, ${hash}, 0, null,
            'correlation-invalid', ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23514",
          constraint: "availability_checks_state_matrix"
        })
      });
      await expect(
        db.execute(sql`
          insert into availability_checks (
            user_id, id, availability_rule_set_id, state, range_starts_at, range_ends_at,
            calendar_ids_attempted, calendars_checked, checked_at, response_hash,
            busy_interval_count, safe_provider_error_code, correlation_id, created_at
          ) values (
            ${userId}::uuid, 'check-stale-persisted', 'rules-1', 'stale',
            '2026-07-27T12:00:00.000Z'::timestamptz,
            '2026-07-27T15:00:00.000Z'::timestamptz,
            '["primary"]'::jsonb, '["primary"]'::jsonb, ${now}::timestamptz,
            ${hash}, 0, null, 'correlation-stale', ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23514",
          constraint: "availability_checks_state_allowed"
        })
      });
    });
  });

  it("enforces same-owner Calendar relationships and founder uniqueness", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      const foreignKeys = await db.execute<{ conname: string }>(sql`
        select conname
        from pg_constraint
        where connamespace = current_schema()::regnamespace
          and contype = 'f'
          and conname in (
            'availability_checks_rule_set_tenant_fk',
            'availability_checks_integration_tenant_fk',
            'calendar_holds_viewing_tenant_fk',
            'calendar_holds_approval_tenant_fk',
            'calendar_holds_check_tenant_fk',
            'viewings_supersedes_tenant_fk'
          )
        order by conname
      `);
      expect(foreignKeys.rows.map(({ conname }) => conname)).toEqual([
        "availability_checks_integration_tenant_fk",
        "availability_checks_rule_set_tenant_fk",
        "calendar_holds_approval_tenant_fk",
        "calendar_holds_check_tenant_fk",
        "calendar_holds_viewing_tenant_fk",
        "viewings_supersedes_tenant_fk"
      ]);

      const indexes = await db.execute<{ indexname: string }>(sql`
        select indexname
        from pg_indexes
        where schemaname = current_schema()
          and indexname in (
            'integration_connections_user_provider_unique',
            'availability_rule_sets_user_unique',
            'calendar_oauth_states_state_hash_unique',
            'calendar_holds_user_idempotency_unique',
            'calendar_holds_user_approval_unique',
            'calendar_holds_user_provider_event_unique'
          )
        order by indexname
      `);
      expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
        "availability_rule_sets_user_unique",
        "calendar_holds_user_approval_unique",
        "calendar_holds_user_idempotency_unique",
        "calendar_holds_user_provider_event_unique",
        "calendar_oauth_states_state_hash_unique",
        "integration_connections_user_provider_unique"
      ]);

      await seedCalendarGraph(db);

      await expect(
        db.execute(sql`
          insert into integration_connections (
            user_id, id, provider, provider_subject_id, granted_scopes, status, created_at, updated_at
          ) values (
            ${userId}::uuid, '338f9f64-7b5a-7c91-a12e-123456789abc'::uuid,
            'google', 'google-subject-2', ARRAY[]::text[], 'partial',
            ${now}::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23505",
          constraint: "integration_connections_user_provider_unique"
        })
      });
      await expect(
        db.execute(sql`
          insert into availability_rule_sets (
            user_id, id, time_zone, weekly_intervals, duration_minutes, minimum_notice_minutes,
            travel_minutes, buffer_minutes, reminders_minutes_before_start,
            conflict_checking_enabled, selected_calendar_ids, schema_version, created_at, updated_at
          ) values (
            ${userId}::uuid, 'rules-2', 'America/New_York', '{}'::jsonb,
            60, 0, 0, 0, '[]'::jsonb, false, '[]'::jsonb, 1,
            ${now}::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23505",
          constraint: "availability_rule_sets_user_unique"
        })
      });
      await expect(
        db.execute(sql`
          insert into availability_checks (
            user_id, id, availability_rule_set_id, integration_connection_id, state,
            range_starts_at, range_ends_at, calendar_ids_attempted, calendars_checked,
            checked_at, response_hash, busy_interval_count, safe_provider_error_code,
            correlation_id, created_at
          ) values (
            ${otherUserId}::uuid, 'cross-owner-check', 'rules-1', ${integrationId}::uuid,
            'vera_rules_only', '2026-07-27T12:00:00.000Z'::timestamptz,
            '2026-07-27T15:00:00.000Z'::timestamptz, '[]'::jsonb, '[]'::jsonb,
            null, null, null, null, 'cross-owner', ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "23503" })
      });
    });
  });

  it("enforces OAuth verifier, state-hash, hold idempotency, and provider identity constraints", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await seedCalendarGraph(db);

      await expect(
        db.execute(sql`
          insert into calendar_oauth_states (
            user_id, id, state_hash, capability, requested_calendar_scopes,
            credential_version, credential_algorithm, credential_key_id, credential_nonce,
            credential_ciphertext, credential_authentication_tag, redirect_uri_hash, return_to,
            expires_at, created_at
          ) values (
            ${otherUserId}::uuid, '438f9f64-7b5a-7c91-a12e-123456789abc'::uuid, ${hash},
            'calendar_conflict_checking',
            '["https://www.googleapis.com/auth/calendar.freebusy"]'::jsonb,
            1, null, null, null, null, null, ${"b".repeat(64)}, '/settings/integrations',
            '2026-07-21T12:10:00.000Z'::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "23514" })
      });

      await expect(
        db.execute(sql`
          insert into calendar_oauth_states (
            user_id, id, state_hash, capability, requested_calendar_scopes,
            credential_version, credential_algorithm, credential_key_id, credential_nonce,
            credential_ciphertext, credential_authentication_tag, redirect_uri_hash, return_to,
            expires_at, created_at
          ) values (
            ${otherUserId}::uuid, '538f9f64-7b5a-7c91-a12e-123456789abc'::uuid, ${hash},
            'calendar_conflict_checking',
            '["https://www.googleapis.com/auth/calendar.freebusy"]'::jsonb,
            1, 'aes-256-gcm', 'key-v1', decode('001122', 'hex'), decode('334455', 'hex'),
            decode('667788', 'hex'), ${"b".repeat(64)}, '/settings/integrations',
            '2026-07-21T12:10:00.000Z'::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23505",
          constraint: "calendar_oauth_states_state_hash_unique"
        })
      });

      await db.execute(sql`
        insert into approvals (
          user_id, id, actor, connector_id, operation, target_type, target_id,
          payload_hash, state, created_at, expires_at, used_at
        ) values (
          ${userId}::uuid, 'approval-2', 'user', 'google-calendar', 'calendar.hold.create',
          'calendar_hold', 'hold-2', ${"2".repeat(64)}, 'pending', ${now}::timestamptz,
          '2026-07-21T12:10:00.000Z'::timestamptz, null
        )
      `);
      await expect(
        db.execute(sql`
          insert into calendar_holds (
            user_id, id, viewing_id, approval_id, availability_check_id, payload_hash,
            idempotency_key, calendar_id, google_event_id, state,
            conflict_check_override, created_at, updated_at
          ) values (
            ${userId}::uuid, 'hold-idempotency-duplicate', 'viewing-1', 'approval-2', 'check-1',
            ${"2".repeat(64)}, ${"f".repeat(64)}, 'primary', ${`vera${"2".repeat(40)}`},
            'approved', false, ${now}::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23505",
          constraint: "calendar_holds_user_idempotency_unique"
        })
      });

      await db.execute(sql`
        insert into approvals (
          user_id, id, actor, connector_id, operation, target_type, target_id,
          payload_hash, state, created_at, expires_at, used_at
        ) values (
          ${userId}::uuid, 'approval-3', 'user', 'google-calendar', 'calendar.hold.create',
          'calendar_hold', 'hold-3', ${"3".repeat(64)}, 'pending', ${now}::timestamptz,
          '2026-07-21T12:10:00.000Z'::timestamptz, null
        )
      `);
      await expect(
        db.execute(sql`
          insert into calendar_holds (
            user_id, id, viewing_id, approval_id, availability_check_id, payload_hash,
            idempotency_key, calendar_id, google_event_id, state,
            conflict_check_override, created_at, updated_at
          ) values (
            ${userId}::uuid, 'hold-provider-duplicate', 'viewing-1', 'approval-3', 'check-1',
            ${"3".repeat(64)}, ${"4".repeat(64)}, 'primary', ${`vera${"1".repeat(40)}`},
            'approved', false, ${now}::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23505",
          constraint: "calendar_holds_user_provider_event_unique"
        })
      });
    });
  });

  it("enforces one null-source production schedule per user and kind", async () => {
    await withPostgresTestDatabase(async ({ db }) => {
      await db.execute(sql`
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values (${userId}::uuid, 'Founder', 'founder@example.test', true,
          ${now}::timestamptz, ${now}::timestamptz)
      `);
      await db.execute(sql`
        insert into production_schedules (
          user_id, id, kind, state, interval_seconds, source_configuration_id,
          next_run_at, created_at, updated_at
        ) values (
          ${userId}::uuid, 'global-a', 'health_reconciliation', 'enabled', 300, null,
          ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
        )
      `);
      await expect(
        db.execute(sql`
          insert into production_schedules (
            user_id, id, kind, state, interval_seconds, source_configuration_id,
            next_run_at, created_at, updated_at
          ) values (
            ${userId}::uuid, 'global-b', 'health_reconciliation', 'enabled', 300, null,
            ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({
        cause: expect.objectContaining({
          code: "23505",
          constraint: "production_schedules_user_global_kind_unique"
        })
      });
    });
  });

  it.each([
    { nonceBytes: 11, ciphertextBytes: 32, tagBytes: 16 },
    { nonceBytes: 12, ciphertextBytes: 0, tagBytes: 16 },
    { nonceBytes: 12, ciphertextBytes: 16_385, tagBytes: 16 },
    { nonceBytes: 12, ciphertextBytes: 32, tagBytes: 15 }
  ])("rejects malformed encrypted Web Push material %#", async (encrypted) => {
    await withPostgresTestDatabase(async ({ db }) => {
      await db.execute(sql`
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values (${userId}::uuid, 'Founder', 'founder@example.test', true,
          ${now}::timestamptz, ${now}::timestamptz)
      `);
      await expect(
        db.execute(sql`
          insert into web_push_subscriptions (
            user_id, id, endpoint_hash, credential_version, credential_algorithm,
            credential_key_id, credential_nonce, credential_ciphertext,
            credential_authentication_tag, status, created_at, updated_at
          ) values (
            ${userId}::uuid, 'subscription-invalid', ${"9".repeat(64)}, 1, 'aes-256-gcm',
            'key-v1', ${Buffer.alloc(encrypted.nonceBytes)},
            ${Buffer.alloc(encrypted.ciphertextBytes)}, ${Buffer.alloc(encrypted.tagBytes)},
            'active', ${now}::timestamptz, ${now}::timestamptz
          )
        `)
      ).rejects.toMatchObject({ cause: expect.objectContaining({ code: "23514" }) });
    });
  });
});
