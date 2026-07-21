import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { withPostgresTestDatabase } from "./testing.ts";

const privateApplicationTables = [
  "activity_events",
  "approvals",
  "browser_nodes",
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
});
