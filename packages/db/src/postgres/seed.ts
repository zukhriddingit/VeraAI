import { SOURCE_POLICY_MANIFEST_FIXTURES } from "../fixtures.ts";
import { createPostgresGlobalPolicyRepository } from "./policy-repository.ts";
import type { PostgresConnection } from "./connection.ts";

export interface PostgresGlobalPolicySeedResult {
  readonly sourcePolicyManifests: number;
}

export async function seedPostgresGlobalPolicy(
  connection: PostgresConnection
): Promise<PostgresGlobalPolicySeedResult> {
  const repository = createPostgresGlobalPolicyRepository(connection.db);
  for (const manifest of SOURCE_POLICY_MANIFEST_FIXTURES) {
    await repository.insert(manifest);
  }
  return { sourcePolicyManifests: (await repository.list()).length };
}
