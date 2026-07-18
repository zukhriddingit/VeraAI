import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection
} from "./index.ts";

const initialMigration = readFileSync(
  new URL("../drizzle/0000_bored_stick.sql", import.meta.url),
  "utf8"
);
let temporaryDirectory: string | null = null;
let connection: VeraDatabaseConnection | null = null;

afterEach(() => {
  connection?.close();
  if (temporaryDirectory !== null) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  connection = null;
  temporaryDirectory = null;
});

function applyInitialMigration(): void {
  if (!connection) {
    throw new Error("Migration test database is not open.");
  }

  for (const statement of initialMigration.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") {
      connection.sqlite.exec(statement);
    }
  }

  connection.sqlite.exec(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
    INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('initial-migration-test-marker', 1784333052106);
  `);
}

function downgradePopulatedDatabaseTo0002Shape(): void {
  if (!connection) {
    throw new Error("Migration test database is not open.");
  }

  connection.sqlite.pragma("foreign_keys = OFF");
  connection.sqlite.exec(`
    DROP TRIGGER raw_listings_no_update;
    DROP TRIGGER raw_listings_no_delete;
    CREATE TABLE __legacy_raw_listings (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      source_listing_id text,
      source_url text,
      capture_method text NOT NULL,
      observed_at text NOT NULL,
      source_posted_at text,
      raw_text text,
      raw_json text,
      capture_metadata text NOT NULL,
      content_hash text NOT NULL,
      idempotency_key text NOT NULL,
      created_at text NOT NULL,
      CONSTRAINT raw_listings_evidence_required CHECK(raw_text IS NOT NULL OR raw_json IS NOT NULL),
      CONSTRAINT raw_listings_capture_method_allowed
        CHECK(capture_method IN ('fixture', 'manual_text', 'manual_structured'))
    );
    INSERT INTO __legacy_raw_listings
    SELECT id, source, source_listing_id, source_url, capture_method, observed_at,
           source_posted_at, raw_text, raw_json, capture_metadata, content_hash,
           idempotency_key, created_at
    FROM raw_listings;
    DROP TABLE raw_listings;
    ALTER TABLE __legacy_raw_listings RENAME TO raw_listings;
    CREATE UNIQUE INDEX raw_listings_idempotency_key_unique
      ON raw_listings (idempotency_key);
    CREATE INDEX raw_listings_source_identity_idx
      ON raw_listings (source, source_listing_id);
    CREATE TRIGGER raw_listings_no_update
    BEFORE UPDATE ON raw_listings
    BEGIN
      SELECT RAISE(ABORT, 'raw_listings are append-only');
    END;
    CREATE TRIGGER raw_listings_no_delete
    BEFORE DELETE ON raw_listings
    BEGIN
      SELECT RAISE(ABORT, 'raw_listings are append-only');
    END;

    CREATE TABLE __legacy_source_policy_manifests (
      schema_version integer DEFAULT 1 NOT NULL,
      connector_id text NOT NULL,
      display_name text DEFAULT 'Sanitized source label' NOT NULL,
      version integer NOT NULL,
      source text NOT NULL,
      enabled integer NOT NULL,
      execution text NOT NULL,
      capabilities text NOT NULL,
      allowed_operations text DEFAULT '[]' NOT NULL,
      allowed_domains text NOT NULL,
      allowed_origins text DEFAULT '[]' NOT NULL,
      allowed_http_methods text DEFAULT '[]' NOT NULL,
      requires_user_session integer NOT NULL,
      requires_approval integer NOT NULL,
      minimum_interval_seconds integer,
      max_concurrency integer DEFAULT 1 NOT NULL,
      global_kill_switch_key text DEFAULT 'integrations.disabled' NOT NULL,
      connector_kill_switch_key text DEFAULT 'integrations.legacy_source_labels' NOT NULL,
      data_classification text DEFAULT 'synthetic' NOT NULL,
      redaction_rules text NOT NULL,
      manual_blocker_behavior text DEFAULT 'stop_and_request_user_action' NOT NULL,
      owner text DEFAULT 'Vera maintainers' NOT NULL,
      reviewed_at text DEFAULT '2026-07-17' NOT NULL,
      decision_record text DEFAULT 'docs/DECISIONS/0004-fail-closed-connectors.md' NOT NULL,
      notes text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      PRIMARY KEY(connector_id, version),
      CONSTRAINT source_policy_manifests_schema_version_supported CHECK(schema_version = 1)
    );
    INSERT INTO __legacy_source_policy_manifests
    SELECT 1, connector_id, display_name, version, source, enabled, execution,
           capabilities, allowed_operations, allowed_domains, allowed_origins,
           allowed_http_methods, requires_user_session, requires_approval,
           minimum_interval_seconds, max_concurrency, global_kill_switch_key,
           connector_kill_switch_key, data_classification, redaction_rules,
           manual_blocker_behavior, owner, reviewed_at, decision_record, notes,
           created_at, updated_at
    FROM source_policy_manifests;
    DROP TABLE source_policy_manifests;
    ALTER TABLE __legacy_source_policy_manifests RENAME TO source_policy_manifests;

    DROP TABLE source_job_attempts;
    DROP TABLE source_jobs;
    DROP TABLE browser_nodes;
    DELETE FROM __drizzle_migrations
      WHERE created_at IN (
        SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 2
      );
  `);
  connection.sqlite.pragma("foreign_keys = ON");

  if ((connection.sqlite.pragma("foreign_key_check") as readonly unknown[]).length > 0) {
    throw new Error("0002 migration fixture has foreign-key integrity violations.");
  }
}

function downgradePopulatedDatabaseTo0003Shape(): void {
  if (!connection) {
    throw new Error("Migration test database is not open.");
  }

  connection.sqlite.pragma("foreign_keys = OFF");
  connection.sqlite.exec(`
    DROP TRIGGER raw_listings_no_update;
    DROP TRIGGER raw_listings_no_delete;
    CREATE TABLE __legacy_raw_listings_0003 (
      id text PRIMARY KEY NOT NULL,
      source text NOT NULL,
      source_listing_id text,
      source_url text,
      acquisition_mode text NOT NULL,
      capture_method text NOT NULL,
      observed_at text NOT NULL,
      source_posted_at text,
      raw_text text,
      raw_json text,
      capture_metadata text NOT NULL,
      content_hash text NOT NULL,
      idempotency_key text NOT NULL,
      created_at text NOT NULL,
      CONSTRAINT raw_listings_evidence_required
        CHECK(raw_text IS NOT NULL OR raw_json IS NOT NULL),
      CONSTRAINT raw_listings_capture_method_allowed
        CHECK(capture_method IN ('fixture', 'manual_text', 'manual_structured')),
      CONSTRAINT raw_listings_acquisition_mode_allowed
        CHECK(acquisition_mode IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
      CONSTRAINT raw_listings_capture_mode_consistency
        CHECK((capture_method = 'fixture' AND acquisition_mode = 'fixture')
          OR (capture_method IN ('manual_text', 'manual_structured')
            AND acquisition_mode = 'user_capture'))
    );
    INSERT INTO __legacy_raw_listings_0003
    SELECT id, source, source_listing_id, source_url, acquisition_mode, capture_method,
           observed_at, source_posted_at, raw_text, raw_json, capture_metadata,
           content_hash, idempotency_key, created_at
    FROM raw_listings;
    DROP TABLE raw_listings;
    ALTER TABLE __legacy_raw_listings_0003 RENAME TO raw_listings;
    CREATE UNIQUE INDEX raw_listings_idempotency_key_unique
      ON raw_listings (idempotency_key);
    CREATE INDEX raw_listings_source_identity_idx
      ON raw_listings (source, source_listing_id);
    CREATE TRIGGER raw_listings_no_update
    BEFORE UPDATE ON raw_listings
    BEGIN
      SELECT RAISE(ABORT, 'raw_listings are append-only');
    END;
    CREATE TRIGGER raw_listings_no_delete
    BEFORE DELETE ON raw_listings
    BEGIN
      SELECT RAISE(ABORT, 'raw_listings are append-only');
    END;

    CREATE TABLE __legacy_source_jobs_0003 (
      id text PRIMARY KEY NOT NULL,
      correlation_id text NOT NULL,
      connector_id text NOT NULL,
      source text NOT NULL,
      acquisition_mode text NOT NULL,
      manifest_version integer NOT NULL,
      trigger text NOT NULL,
      operation text NOT NULL,
      payload text NOT NULL,
      payload_hash text NOT NULL,
      idempotency_key text NOT NULL,
      status text NOT NULL,
      attempts integer NOT NULL,
      max_attempts integer NOT NULL,
      manual_action text,
      deferred_reason text,
      result text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      completed_at text,
      CONSTRAINT source_jobs_acquisition_mode_allowed
        CHECK(acquisition_mode IN ('official_api', 'email_alert', 'local_browser', 'user_capture', 'fixture')),
      CONSTRAINT source_jobs_manifest_version_positive CHECK(manifest_version > 0),
      CONSTRAINT source_jobs_trigger_allowed CHECK(trigger IN ('manual', 'scheduled')),
      CONSTRAINT source_jobs_status_allowed
        CHECK(status IN ('queued', 'dispatched', 'running', 'completed', 'retryable_failed',
          'permanently_failed', 'deferred_node_offline', 'manual_action_required',
          'cancelled_by_policy')),
      CONSTRAINT source_jobs_attempts_valid
        CHECK(attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts),
      CONSTRAINT source_jobs_terminal_consistency
        CHECK((status IN ('completed', 'permanently_failed', 'cancelled_by_policy'))
          = (completed_at IS NOT NULL)),
      CONSTRAINT source_jobs_manual_action_consistency
        CHECK((status = 'manual_action_required') = (manual_action IS NOT NULL)),
      CONSTRAINT source_jobs_deferred_reason_consistency
        CHECK((status = 'deferred_node_offline') = (deferred_reason IS NOT NULL)),
      CONSTRAINT source_jobs_deferred_reason_allowed
        CHECK(deferred_reason IS NULL OR deferred_reason IN
          ('node_unregistered', 'node_offline', 'stale_heartbeat', 'node_revoked'))
    );
    INSERT INTO __legacy_source_jobs_0003
    SELECT id, correlation_id, connector_id, source, acquisition_mode, manifest_version,
           trigger, operation, payload, payload_hash, idempotency_key, status, attempts,
           max_attempts, manual_action, deferred_reason, result, created_at, updated_at,
           completed_at
    FROM source_jobs;
    DROP TABLE source_jobs;
    ALTER TABLE __legacy_source_jobs_0003 RENAME TO source_jobs;
    CREATE UNIQUE INDEX source_jobs_idempotency_key_unique ON source_jobs (idempotency_key);
    CREATE INDEX source_jobs_status_updated_idx ON source_jobs (status, updated_at);
    CREATE INDEX source_jobs_connector_idx ON source_jobs (connector_id, created_at);

    DELETE FROM __drizzle_migrations
      WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations);
  `);
  connection.sqlite.pragma("foreign_keys = ON");

  if ((connection.sqlite.pragma("foreign_key_check") as readonly unknown[]).length > 0) {
    throw new Error("0003 migration fixture has foreign-key integrity violations.");
  }
}

function insertInitialEvidence(): void {
  if (!connection) {
    throw new Error("Migration test database is not open.");
  }

  connection.sqlite
    .prepare(
      `INSERT INTO raw_listings (
        id, source, source_listing_id, source_url, capture_method, observed_at,
        source_posted_at, raw_text, raw_json, capture_metadata, content_hash,
        idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "raw-migration-probe",
      "craigslist",
      "fixture-migration-probe",
      "https://example.invalid/fixtures/craigslist/migration-probe",
      "fixture",
      "2026-07-17T12:00:00.000Z",
      null,
      "Sanitized migration probe.",
      null,
      JSON.stringify({ sanitized: true }),
      "a".repeat(64),
      "b".repeat(64),
      "2026-07-17T12:00:00.000Z"
    );
  connection.sqlite
    .prepare(
      `INSERT INTO listing_source_records (
        id, raw_listing_id, source, source_listing_id, source_url, title,
        address_line_1, address_unit, address_city, address_region,
        address_postal_code, address_country_code, monthly_rent_cents,
        recurring_fees_cents, bedrooms_half_units, bathrooms_half_units,
        square_feet, property_type, available_on, lease_term_months, pet_policy,
        amenities, description, extraction_confidence_basis_points,
        completeness_basis_points, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "src-migration-probe",
      "raw-migration-probe",
      "craigslist",
      "fixture-migration-probe",
      "https://example.invalid/fixtures/craigslist/migration-probe",
      "Migration probe listing",
      "1 Synthetic Way",
      null,
      "Harbor City",
      "MA",
      "00001",
      "US",
      200_000,
      null,
      2,
      2,
      null,
      "apartment",
      null,
      12,
      "null",
      "[]",
      null,
      10_000,
      7_000,
      "2026-07-17T12:00:00.000Z",
      "2026-07-17T12:00:00.000Z"
    );
  connection.sqlite
    .prepare(
      `INSERT INTO field_provenance (
        id, listing_source_record_id, raw_listing_id, field_path,
        extraction_method, confidence_basis_points, observed_at, evidence_excerpt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "prov-migration-probe",
      "src-migration-probe",
      "raw-migration-probe",
      "title",
      "fixture_structured",
      10_000,
      "2026-07-17T12:00:00.000Z",
      null
    );
  connection.sqlite
    .prepare(
      `INSERT INTO source_policy_manifests (
        connector_id, version, source, enabled, execution, capabilities,
        requires_user_session, requires_approval, minimum_interval_seconds,
        allowed_domains, kill_switch_active, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "fixture-label-craigslist",
      1,
      "craigslist",
      0,
      "manual",
      "[]",
      1,
      1,
      null,
      "[]",
      1,
      "Sanitized source label only. No platform access capability is enabled.",
      "2026-07-17T12:00:00.000Z",
      "2026-07-17T12:00:00.000Z"
    );
}

describe("forward persistence migrations", () => {
  it("preserves existing evidence, applies safe defaults, and restores append-only triggers", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-migration-"));
    connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
    applyInitialMigration();
    insertInitialEvidence();

    migrateDatabase(connection);

    expect(
      connection.sqlite
        .prepare(
          `SELECT source_posted_at AS sourcePostedAt, contact_channel AS contactChannel
           FROM listing_source_records WHERE id = ?`
        )
        .get("src-migration-probe")
    ).toEqual({ sourcePostedAt: null, contactChannel: "unknown" });
    expect(
      connection.sqlite
        .prepare(
          `SELECT value_status AS valueStatus, unknown_reason AS unknownReason
           FROM field_provenance WHERE id = ?`
        )
        .get("prov-migration-probe")
    ).toEqual({ valueStatus: "known", unknownReason: null });
    expect(
      connection.sqlite
        .prepare(
          `SELECT schema_version AS schemaVersion, display_name AS displayName,
                  acquisition_mode AS acquisitionMode, policy_state AS policyState,
                  allowed_operations AS allowedOperations,
                  connector_kill_switch_key AS connectorKillSwitchKey
           FROM source_policy_manifests WHERE connector_id = ? AND version = 1`
        )
        .get("fixture-label-craigslist")
    ).toEqual({
      schemaVersion: 2,
      displayName: "Sanitized source label",
      acquisitionMode: "fixture",
      policyState: "disabled",
      allowedOperations: "[]",
      connectorKillSwitchKey: "integrations.legacy_source_labels"
    });
    expect(
      connection.sqlite
        .prepare("SELECT acquisition_mode AS acquisitionMode FROM raw_listings WHERE id = ?")
        .get("raw-migration-probe")
    ).toEqual({ acquisitionMode: "fixture" });
    expect(
      connection.sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger'
           ORDER BY name`
        )
        .all()
        .map((row) => (row as { name: string }).name)
    ).toEqual([
      "activity_events_no_delete",
      "activity_events_no_update",
      "listing_extractions_no_delete",
      "listing_extractions_no_update",
      "raw_listings_no_delete",
      "raw_listings_no_update",
      "source_job_attempts_no_delete",
      "source_job_attempts_no_update"
    ]);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      connection?.sqlite
        .prepare("UPDATE raw_listings SET raw_text = ? WHERE id = ?")
        .run("changed", "raw-migration-probe")
    ).toThrow(/append-only/u);
  });

  it("migrates a populated 0002 database without changing seeded evidence or queued jobs", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-migration-0002-"));
    connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
    migrateDatabase(connection);
    const repositories = createSqliteRepositories(connection);
    const seeded = seedDatabase(repositories);
    const job = repositories.normalizationJobs.enqueue({
      id: "job-migration-0002-probe",
      rawListingId: "raw-juniper-zillow",
      idempotencyKey: "8".repeat(64),
      availableAt: "2026-07-17T13:00:00.000Z",
      maxAttempts: 3,
      correlationId: "correlation-migration-0002",
      causationId: "event-seed-v1-completed",
      createdAt: "2026-07-17T13:00:00.000Z"
    }).record;
    const rawIdentityBefore = connection.sqlite
      .prepare(
        `SELECT id, content_hash AS contentHash, idempotency_key AS idempotencyKey
         FROM raw_listings ORDER BY id`
      )
      .all();
    const canonicalIdsBefore = connection.sqlite
      .prepare("SELECT id FROM canonical_listings ORDER BY id")
      .all();

    downgradePopulatedDatabaseTo0002Shape();

    migrateDatabase(connection);

    const migratedRepositories = createSqliteRepositories(connection);
    expect(migratedRepositories.rawListings.count()).toBe(seeded.rawListings);
    expect(migratedRepositories.sourceRecords.count()).toBe(seeded.sourceRecords);
    expect(migratedRepositories.fieldProvenance.count()).toBe(seeded.fieldProvenance);
    expect(migratedRepositories.canonicalListings.count()).toBe(seeded.canonicalListings);
    expect(migratedRepositories.activityEvents.count()).toBe(seeded.activityEvents);
    expect(migratedRepositories.normalizationJobs.getById(job.id)).toEqual(job);
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, content_hash AS contentHash, idempotency_key AS idempotencyKey
           FROM raw_listings ORDER BY id`
        )
        .all()
    ).toEqual(rawIdentityBefore);
    expect(
      connection.sqlite.prepare("SELECT id FROM canonical_listings ORDER BY id").all()
    ).toEqual(canonicalIdsBefore);
    expect(
      connection.sqlite
        .prepare(
          `SELECT acquisition_mode AS acquisitionMode, policy_state AS policyState
           FROM source_policy_manifests WHERE connector_id = 'manual.capture.v1'`
        )
        .get()
    ).toEqual({ acquisitionMode: "user_capture", policyState: "user_triggered_only" });
    expect(
      connection.sqlite
        .prepare(
          `SELECT count(*) AS count FROM raw_listings
           WHERE acquisition_mode = 'fixture'`
        )
        .get()
    ).toEqual({ count: 12 });
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(
      connection.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name)
    ).toEqual([
      "activity_events_no_delete",
      "activity_events_no_update",
      "listing_extractions_no_delete",
      "listing_extractions_no_update",
      "raw_listings_no_delete",
      "raw_listings_no_update",
      "source_job_attempts_no_delete",
      "source_job_attempts_no_update"
    ]);
  });

  it("migrates populated 0003 jobs and evidence without resetting identities", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-migration-0003-"));
    connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
    migrateDatabase(connection);
    const repositories = createSqliteRepositories(connection);
    seedDatabase(repositories);
    const sourceJob = repositories.sourceJobs.enqueue({
      id: "source-job-migration-0003",
      correlationId: "correlation-source-job-migration-0003",
      connectorId: "zillow.browser.saved-search.v1",
      source: "zillow",
      acquisitionMode: "local_browser",
      manifestVersion: 1,
      trigger: "scheduled",
      capability: "browser.capture",
      approvalId: null,
      operation: "browser.capture_saved_search",
      payload: {
        acquisitionMode: "local_browser",
        nodeId: "browser-node-local-1",
        savedSearchId: "saved-search-migration-0003",
        savedSearchUrl: "https://www.zillow.com/homes/for_rent/",
        committedCursor: null,
        limits: {
          maxPages: 1,
          maxRecords: 10,
          maxBytes: 100_000,
          maxDurationMilliseconds: 30_000,
          maxConcurrency: 1
        }
      },
      payloadHash: "c".repeat(64),
      idempotencyKey: "d".repeat(64),
      status: "queued",
      attempts: 1,
      maxAttempts: 3,
      manualAction: null,
      deferredReason: null,
      result: null,
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
      completedAt: null
    }).record;
    const sourceJobAttempt = repositories.sourceJobAttempts.append({
      id: "source-job-attempt-migration-0003",
      sourceJobId: sourceJob.id,
      attemptNumber: 1,
      startedAt: "2026-07-18T12:00:00.000Z",
      completedAt: "2026-07-18T12:01:00.000Z",
      outcomeStatus: "deferred_node_offline",
      error: null,
      deferredReason: "node_offline",
      correlationId: sourceJob.correlationId,
      payloadHash: sourceJob.payloadHash
    });
    const rawIdentityBefore = connection.sqlite
      .prepare(
        `SELECT id, content_hash AS contentHash, idempotency_key AS idempotencyKey
         FROM raw_listings ORDER BY id`
      )
      .all();

    downgradePopulatedDatabaseTo0003Shape();
    migrateDatabase(connection);

    const migratedRepositories = createSqliteRepositories(connection);
    expect(migratedRepositories.sourceJobs.getById(sourceJob.id)).toEqual(sourceJob);
    expect(migratedRepositories.sourceJobAttempts.listByJobId(sourceJob.id)).toEqual([
      sourceJobAttempt
    ]);
    expect(
      connection.sqlite
        .prepare(
          `SELECT id, content_hash AS contentHash, idempotency_key AS idempotencyKey
           FROM raw_listings ORDER BY id`
        )
        .all()
    ).toEqual(rawIdentityBefore);

    const insertRaw = connection.sqlite.prepare(
      `INSERT INTO raw_listings (
        id, source, source_listing_id, source_url, acquisition_mode, capture_method,
        observed_at, source_posted_at, raw_text, raw_json, capture_metadata,
        content_hash, idempotency_key, created_at
      ) VALUES (?, 'other', ?, NULL, ?, ?, '2026-07-18T12:05:00.000Z', NULL,
        'Sanitized production-mode migration probe.', NULL, '{"sanitized":true}', ?, ?,
        '2026-07-18T12:05:00.000Z')`
    );
    for (const [mode, captureMethod, suffix, contentHash, idempotencyKey] of [
      ["official_api", "official_api", "api", "a".repeat(64), "1".repeat(64)],
      ["email_alert", "email_alert", "email", "b".repeat(64), "2".repeat(64)],
      ["local_browser", "local_browser", "browser", "c".repeat(64), "3".repeat(64)]
    ] as const) {
      insertRaw.run(
        `raw-migration-${suffix}`,
        `source-migration-${suffix}`,
        mode,
        captureMethod,
        contentHash,
        idempotencyKey
      );
    }
    expect(() =>
      insertRaw.run(
        "raw-migration-mismatch",
        "source-migration-mismatch",
        "official_api",
        "email_alert",
        "f".repeat(64),
        "9".repeat(64)
      )
    ).toThrow(/raw_listings_capture_mode_consistency/u);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      connection?.sqlite
        .prepare("UPDATE raw_listings SET raw_text = ? WHERE id = ?")
        .run("changed", "raw-migration-api")
    ).toThrow(/append-only/u);
  });
});
