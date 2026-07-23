import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { parsePostgresConfig } from "./config.ts";
import { openPostgresConnection, type PostgresConnection } from "./connection.ts";
import { checkPostgresReadiness, migratePostgres, postgresMigrationsFolder } from "./migrations.ts";
import { withPostgresTestDatabase } from "./testing.ts";

interface BaselineMigrationContext {
  readonly connection: PostgresConnection;
  readonly schemaName: string;
  migrateLatest(): Promise<void>;
}

async function withBaselineMigrationDatabase<T>(
  operation: (context: BaselineMigrationContext) => Promise<T>,
  baselineMigrationCount = 1
): Promise<T> {
  const connectionString = process.env.TEST_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required for migration tests.");
  const parsedUrl = new URL(connectionString);
  if (parsedUrl.pathname !== "/vera_test") {
    throw new Error("Migration tests require the vera_test database.");
  }

  const schemaName = `vera_test_${randomBytes(12).toString("hex")}`;
  const baselineFolder = mkdtempSync(join(tmpdir(), "vera-pg-baseline-"));
  const metadataFolder = join(baselineFolder, "meta");
  mkdirSync(metadataFolder);
  const journal = JSON.parse(
    readFileSync(join(postgresMigrationsFolder, "meta", "_journal.json"), "utf8")
  ) as {
    version: string;
    dialect: string;
    entries: readonly { readonly tag: string }[];
  };
  for (const entry of journal.entries.slice(0, baselineMigrationCount)) {
    copyFileSync(
      join(postgresMigrationsFolder, `${entry.tag}.sql`),
      join(baselineFolder, `${entry.tag}.sql`)
    );
  }
  writeFileSync(
    join(metadataFolder, "_journal.json"),
    JSON.stringify(
      { ...journal, entries: journal.entries.slice(0, baselineMigrationCount) },
      null,
      2
    )
  );

  const administrator = new Pool({
    connectionString,
    max: 1,
    application_name: "vera-calendar-migration-test-admin"
  });
  let connection: PostgresConnection | null = null;
  let schemaCreated = false;

  try {
    await administrator.query(`create schema "${schemaName}"`);
    schemaCreated = true;
    const config = parsePostgresConfig({ ...process.env, DATABASE_URL: connectionString });
    connection = openPostgresConnection(config, { searchPath: schemaName });
    await migratePostgres(connection, {
      migrationsFolder: baselineFolder,
      migrationsSchema: schemaName
    });
    return await operation({
      connection,
      schemaName,
      migrateLatest: () =>
        migratePostgres(connection as PostgresConnection, {
          migrationsFolder: postgresMigrationsFolder,
          migrationsSchema: schemaName
        })
    });
  } finally {
    await connection?.close();
    if (schemaCreated) await administrator.query(`drop schema if exists "${schemaName}" cascade`);
    await administrator.end();
    rmSync(baselineFolder, { recursive: true, force: true });
  }
}

describe("PostgreSQL migration readiness", () => {
  it("keeps the Calendar migration additive and schema-portable", () => {
    const migration = readFileSync(
      join(postgresMigrationsFolder, "0001_calendar_availability.sql"),
      "utf8"
    );
    expect(migration).not.toMatch(/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/iu);
    expect(migration).not.toContain('REFERENCES "public".');
    expect(migration).toContain('CREATE TRIGGER "availability_checks_append_only"');
  });

  it("keeps the OpenClaw migration additive, portable, and fail-closed", () => {
    const migration = readFileSync(
      join(postgresMigrationsFolder, "0002_openclaw_current_tab.sql"),
      "utf8"
    );
    expect(migration).not.toMatch(/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/iu);
    expect(migration).not.toContain('REFERENCES "public".');
    expect(migration).toContain('"enabled" boolean DEFAULT false NOT NULL');
    expect(migration).toContain("\"expected_openclaw_version\" text DEFAULT '2026.5.28' NOT NULL");
  });

  it("keeps the founder hardening migration additive, portable, and fail-closed", () => {
    const migration = readFileSync(
      join(postgresMigrationsFolder, "0004_founder_security_hardening.sql"),
      "utf8"
    );
    expect(migration).toContain("production_schedules_user_global_kind_unique");
    expect(migration).toContain('WHERE "source_configuration_id" IS NULL');
    expect(migration).toContain('octet_length("credential_nonce") = 12');
    expect(migration).toContain('octet_length("credential_authentication_tag") = 16');
    expect(migration).toContain('octet_length("credential_ciphertext") BETWEEN 1 AND 16384');
    expect(migration).toContain('CREATE TABLE "integration_refresh_leases"');
    expect(migration).toContain("integration_refresh_leases_connection_tenant_fk");
    expect(migration).not.toMatch(/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/iu);
    expect(migration).not.toContain('REFERENCES "public".');
  });

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

  it("preserves populated baseline Viewing and listing rows while applying later migrations", async () => {
    await withBaselineMigrationDatabase(async ({ connection, schemaName, migrateLatest }) => {
      const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
      const now = "2026-07-21T12:00:00.000Z";
      const legacyWindows = [
        {
          startsAt: "2026-07-27T13:00:00.000Z",
          endsAt: "2026-07-27T14:00:00.000Z"
        }
      ];
      await connection.db.execute(sql`
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values (${userId}::uuid, 'Legacy Founder', 'legacy@example.test', true,
          ${now}::timestamptz, ${now}::timestamptz)
      `);
      await connection.db.execute(sql`
        insert into integration_connections (
          user_id, id, provider, provider_subject_id, granted_scopes, status, created_at, updated_at
        ) values (
          ${userId}::uuid, '138f9f64-7b5a-7c91-a12e-123456789abc'::uuid,
          'google', 'legacy-google-subject', ARRAY[]::text[], 'partial',
          ${now}::timestamptz, ${now}::timestamptz
        )
      `);
      await connection.db.execute(sql`
        insert into search_profiles (
          user_id, id, name, version, location_text, pet_requirements, commute_anchors,
          hard_constraints, weighted_preferences, notification_rules, created_at, updated_at
        ) values (
          ${userId}::uuid, 'profile-legacy', 'Legacy profile', 1, 'Boston, MA',
          '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
          ${now}::timestamptz, ${now}::timestamptz
        )
      `);
      await connection.db.execute(sql`
        insert into raw_listings (
          user_id, id, source, acquisition_mode, capture_method, observed_at, raw_text,
          capture_metadata, content_hash, idempotency_key, created_at
        ) values (
          ${userId}::uuid, 'raw-legacy', 'other', 'fixture', 'fixture', ${now}::timestamptz,
          'Sanitized legacy fixture', '{}'::jsonb, ${"a".repeat(64)},
          'legacy-fixture-1', ${now}::timestamptz
        )
      `);
      await connection.db.execute(sql`
        insert into listing_source_records (
          user_id, id, raw_listing_id, source, contact_channel, title, amenities,
          extraction_confidence_basis_points, completeness_basis_points, observed_at, created_at
        ) values (
          ${userId}::uuid, 'source-legacy', 'raw-legacy', 'other', 'unknown',
          'Sanitized legacy listing', '[]'::jsonb, 10000, 5000,
          ${now}::timestamptz, ${now}::timestamptz
        )
      `);
      await connection.db.execute(sql`
        insert into canonical_listings (
          user_id, id, search_profile_id, primary_source_record_id, title, amenities,
          lifecycle_state, completeness_basis_points, freshest_observed_at, created_at, updated_at
        ) values (
          ${userId}::uuid, 'listing-legacy', 'profile-legacy', 'source-legacy',
          'Sanitized legacy listing', '[]'::jsonb, 'tour_proposed', 5000,
          ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
        )
      `);
      await connection.db.execute(sql`
        insert into viewings (
          user_id, id, canonical_listing_id, proposed_windows, confirmed_window,
          time_zone, calendar_reference, state, notes, metadata, created_at, updated_at
        ) values (
          ${userId}::uuid, 'viewing-legacy', 'listing-legacy',
          ${JSON.stringify(legacyWindows)}::jsonb, null, 'America/New_York', null,
          'proposed', null, '{}'::jsonb, ${now}::timestamptz, ${now}::timestamptz
        )
      `);

      await migrateLatest();

      const viewing = await connection.db.execute<{
        proposed_windows: unknown;
        selected_window: unknown;
        supersedes_viewing_id: string | null;
      }>(sql`
        select proposed_windows, selected_window, supersedes_viewing_id
        from viewings
        where user_id = ${userId}::uuid and id = 'viewing-legacy'
      `);
      expect(viewing.rows).toEqual([
        {
          proposed_windows: legacyWindows,
          selected_window: null,
          supersedes_viewing_id: null
        }
      ]);

      const preserved = await connection.db.execute<{ listings: number; integrations: number }>(sql`
        select
          (select count(*)::int from canonical_listings where user_id = ${userId}::uuid) as listings,
          (select count(*)::int from integration_connections where user_id = ${userId}::uuid) as integrations
      `);
      expect(preserved.rows).toEqual([{ listings: 1, integrations: 1 }]);

      const migrationCount = await connection.pool.query<{ count: number }>(
        `select count(*)::int as count from "${schemaName}"."__drizzle_migrations"`
      );
      expect(migrationCount.rows).toEqual([{ count: 5 }]);
    });
  });

  it("preserves valid schedule and encrypted subscription rows while applying founder hardening", async () => {
    await withBaselineMigrationDatabase(async ({ connection, schemaName, migrateLatest }) => {
      const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
      const now = "2026-07-22T12:00:00.000Z";
      await connection.db.execute(sql`
          insert into users (id, name, email, email_verified, created_at, updated_at)
          values (${userId}::uuid, 'Founder', 'founder@example.test', true,
            ${now}::timestamptz, ${now}::timestamptz)
        `);
      await connection.db.execute(sql`
          insert into production_schedules (
            user_id, id, kind, state, interval_seconds, source_configuration_id,
            next_run_at, created_at, updated_at
          ) values (
            ${userId}::uuid, 'schedule-global', 'health_reconciliation', 'enabled', 300, null,
            ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz
          )
        `);
      await connection.db.execute(sql`
          insert into web_push_subscriptions (
            user_id, id, endpoint_hash, credential_version, credential_algorithm,
            credential_key_id, credential_nonce, credential_ciphertext,
            credential_authentication_tag, status, created_at, updated_at
          ) values (
            ${userId}::uuid, 'subscription-valid', ${"a".repeat(64)}, 1, 'aes-256-gcm',
            'key-v1', decode(${"00".repeat(12)}, 'hex'), decode(${"11".repeat(32)}, 'hex'),
            decode(${"22".repeat(16)}, 'hex'), 'active', ${now}::timestamptz, ${now}::timestamptz
          )
        `);

      await migrateLatest();

      const preserved = await connection.db.execute<{
        schedules: number;
        nonce: string;
        ciphertext: string;
        tag: string;
      }>(sql`
          select
            (select count(*)::int from production_schedules where user_id = ${userId}::uuid) as schedules,
            encode(credential_nonce, 'hex') as nonce,
            encode(credential_ciphertext, 'hex') as ciphertext,
            encode(credential_authentication_tag, 'hex') as tag
          from web_push_subscriptions
          where user_id = ${userId}::uuid and id = 'subscription-valid'
        `);
      expect(preserved.rows).toEqual([
        {
          schedules: 1,
          nonce: "00".repeat(12),
          ciphertext: "11".repeat(32),
          tag: "22".repeat(16)
        }
      ]);
      const migrationCount = await connection.pool.query<{ count: number }>(
        `select count(*)::int as count from "${schemaName}"."__drizzle_migrations"`
      );
      expect(migrationCount.rows).toEqual([{ count: 5 }]);
    }, 4);
  });

  it("refuses ambiguous null-source schedules without deleting either row", async () => {
    await withBaselineMigrationDatabase(async ({ connection, schemaName, migrateLatest }) => {
      const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
      const now = "2026-07-22T12:00:00.000Z";
      await connection.db.execute(sql`
          insert into users (id, name, email, email_verified, created_at, updated_at)
          values (${userId}::uuid, 'Founder', 'founder@example.test', true,
            ${now}::timestamptz, ${now}::timestamptz)
        `);
      await connection.db.execute(sql`
          insert into production_schedules (
            user_id, id, kind, state, interval_seconds, source_configuration_id,
            next_run_at, created_at, updated_at
          ) values
            (${userId}::uuid, 'schedule-a', 'health_reconciliation', 'enabled', 300, null,
              ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz),
            (${userId}::uuid, 'schedule-b', 'health_reconciliation', 'enabled', 300, null,
              ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
        `);

      await expect(migrateLatest()).rejects.toThrow(
        "production_schedules contains duplicate null-source rows"
      );
      const preserved = await connection.db.execute<{ count: number }>(sql`
          select count(*)::int as count from production_schedules
          where user_id = ${userId}::uuid and source_configuration_id is null
        `);
      expect(preserved.rows).toEqual([{ count: 2 }]);
      const migrationCount = await connection.pool.query<{ count: number }>(
        `select count(*)::int as count from "${schemaName}"."__drizzle_migrations"`
      );
      expect(migrationCount.rows).toEqual([{ count: 4 }]);
    }, 4);
  });

  it("refuses ambiguous legacy Google account links without deleting either credential row", async () => {
    await withBaselineMigrationDatabase(async ({ connection, schemaName, migrateLatest }) => {
      const userId = "018f9f64-7b5a-7c91-a12e-123456789abc";
      const now = "2026-07-21T12:00:00.000Z";
      await connection.db.execute(sql`
        insert into users (id, name, email, email_verified, created_at, updated_at)
        values (${userId}::uuid, 'Legacy Founder', 'legacy@example.test', true,
          ${now}::timestamptz, ${now}::timestamptz)
      `);
      await connection.db.execute(sql`
        insert into integration_connections (
          user_id, id, provider, provider_subject_id, granted_scopes, status, created_at, updated_at
        ) values
          (${userId}::uuid, '138f9f64-7b5a-7c91-a12e-123456789abc'::uuid,
            'google', 'legacy-google-subject-a', ARRAY[]::text[], 'partial',
            ${now}::timestamptz, ${now}::timestamptz),
          (${userId}::uuid, '238f9f64-7b5a-7c91-a12e-123456789abc'::uuid,
            'google', 'legacy-google-subject-b', ARRAY[]::text[], 'partial',
            ${now}::timestamptz, ${now}::timestamptz)
      `);

      await expect(migrateLatest()).rejects.toThrow(
        "multiple integration_connections exist for one user and provider"
      );

      const preserved = await connection.db.execute<{ count: number }>(sql`
        select count(*)::int as count
        from integration_connections
        where user_id = ${userId}::uuid and provider = 'google'
      `);
      expect(preserved.rows).toEqual([{ count: 2 }]);

      const migrationCount = await connection.pool.query<{ count: number }>(
        `select count(*)::int as count from "${schemaName}"."__drizzle_migrations"`
      );
      expect(migrationCount.rows).toEqual([{ count: 1 }]);
    });
  });
});
