import { SOURCE_POLICY_MANIFEST_FIXTURES } from "../fixtures.ts";
import { createPostgresGlobalPolicyRepository } from "./policy-repository.ts";
import type { PostgresConnection } from "./connection.ts";

export interface PostgresGlobalPolicySeedResult {
  readonly sourcePolicyManifests: number;
  readonly inserted: number;
}

export async function seedPostgresGlobalPolicy(
  connection: PostgresConnection
): Promise<PostgresGlobalPolicySeedResult> {
  const repository = createPostgresGlobalPolicyRepository(connection.db);
  let inserted = 0;
  for (const manifest of SOURCE_POLICY_MANIFEST_FIXTURES) {
    if ((await repository.get(manifest.connectorId, manifest.version)) === null) inserted += 1;
    await repository.insert(manifest);
  }
  return { sourcePolicyManifests: (await repository.list()).length, inserted };
}
