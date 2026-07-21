import { EntityIdSchema, SourcePolicyManifestSchema } from "@vera/domain";
import { and, asc, desc, eq } from "drizzle-orm";

import type { GlobalPolicyRepository, SourcePolicyManifestReader } from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import { mapSourcePolicyManifestRow } from "./row-mappers.ts";
import { sourcePolicyManifests } from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

function values(input: unknown) {
  const manifest = SourcePolicyManifestSchema.parse(input);
  return {
    ...manifest,
    createdAt: new Date(manifest.createdAt),
    updatedAt: new Date(manifest.updatedAt)
  };
}

export function createPostgresGlobalPolicyRepository(db: PostgresExecutor): GlobalPolicyRepository {
  const repository: GlobalPolicyRepository = {
    async insert(input) {
      const manifest = SourcePolicyManifestSchema.parse(input);
      try {
        const rows = await db
          .insert(sourcePolicyManifests)
          .values(values(manifest))
          .onConflictDoNothing({
            target: [sourcePolicyManifests.connectorId, sourcePolicyManifests.version]
          })
          .returning();
        if (rows[0]) return mapSourcePolicyManifestRow(rows[0]);
        const existing = await repository.get(manifest.connectorId, manifest.version);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(manifest)) {
          throw new PostgresRepositoryError(
            "conflict",
            false,
            "The policy version already exists with different content."
          );
        }
        return existing;
      } catch (error: unknown) {
        throw mapPostgresError(error);
      }
    },
    async get(connectorInput, versionInput) {
      const connectorId = EntityIdSchema.parse(connectorInput);
      if (!Number.isInteger(versionInput) || versionInput <= 0) {
        throw new Error("Manifest version must be a positive integer.");
      }
      const rows = await db
        .select()
        .from(sourcePolicyManifests)
        .where(
          and(
            eq(sourcePolicyManifests.connectorId, connectorId),
            eq(sourcePolicyManifests.version, versionInput)
          )
        )
        .limit(1);
      return rows[0] ? mapSourcePolicyManifestRow(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(sourcePolicyManifests)
        .orderBy(asc(sourcePolicyManifests.connectorId), desc(sourcePolicyManifests.version));
      return rows.map(mapSourcePolicyManifestRow);
    },
    async listLatest() {
      const manifests = await repository.list();
      const latest = new Map<string, (typeof manifests)[number]>();
      for (const manifest of manifests) {
        if (!latest.has(manifest.connectorId)) latest.set(manifest.connectorId, manifest);
      }
      return [...latest.values()];
    }
  };
  return repository;
}

export function createPostgresPolicyReader(db: PostgresExecutor): SourcePolicyManifestReader {
  const repository = createPostgresGlobalPolicyRepository(db);
  return {
    get: repository.get,
    list: repository.list,
    listLatest: repository.listLatest
  };
}
