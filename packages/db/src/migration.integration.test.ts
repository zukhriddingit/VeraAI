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
const ingestionMigration = readFileSync(
  new URL("../drizzle/0001_tiny_peter_parker.sql", import.meta.url),
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

function applyIngestionMigration(): void {
  if (!connection) {
    throw new Error("Migration test database is not open.");
  }

  for (const statement of ingestionMigration.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") {
      connection.sqlite.exec(statement);
    }
  }

  connection.sqlite
    .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run("ingestion-migration-test-marker", 1784339395308);
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
                  allowed_operations AS allowedOperations,
                  connector_kill_switch_key AS connectorKillSwitchKey
           FROM source_policy_manifests WHERE connector_id = ? AND version = 1`
        )
        .get("fixture-label-craigslist")
    ).toEqual({
      schemaVersion: 1,
      displayName: "Sanitized source label",
      allowedOperations: "[]",
      connectorKillSwitchKey: "integrations.legacy_source_labels"
    });
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
      "raw_listings_no_update"
    ]);
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(() =>
      connection?.sqlite
        .prepare("UPDATE raw_listings SET raw_text = ? WHERE id = ?")
        .run("changed", "raw-migration-probe")
    ).toThrow(/append-only/u);
  });

  it("migrates a populated 0001 database without losing evidence or queued jobs", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "vera-migration-0002-"));
    connection = openDatabase({ filePath: join(temporaryDirectory, "vera.sqlite") });
    applyInitialMigration();
    applyIngestionMigration();
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

    migrateDatabase(connection);

    const migratedRepositories = createSqliteRepositories(connection);
    expect(migratedRepositories.rawListings.count()).toBe(seeded.rawListings);
    expect(migratedRepositories.sourceRecords.count()).toBe(seeded.sourceRecords);
    expect(migratedRepositories.fieldProvenance.count()).toBe(seeded.fieldProvenance);
    expect(migratedRepositories.canonicalListings.count()).toBe(seeded.canonicalListings);
    expect(migratedRepositories.activityEvents.count()).toBe(seeded.activityEvents);
    expect(migratedRepositories.normalizationJobs.getById(job.id)).toEqual(job);
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
      "raw_listings_no_update"
    ]);
  });
});
