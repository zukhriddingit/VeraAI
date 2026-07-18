import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import { CaptureErrorResponseSchema, ConnectorStatusCollectionResponseSchema } from "@vera/domain";

import {
  createPersistedPolicyRegistry,
  listSourceConnectors
} from "../../../lib/connector-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function GET(): Promise<Response> {
  const generatedAt = new Date().toISOString();
  let connection: ReturnType<typeof openExistingDatabase> | null = null;

  try {
    connection = openExistingDatabase();
    const repositories = createSqliteRepositories(connection);
    const registry = createPersistedPolicyRegistry(repositories);
    const connectors = listSourceConnectors().map((connector) => connector.health(registry));
    const result = ConnectorStatusCollectionResponseSchema.parse({
      connectors,
      count: connectors.length,
      generatedAt
    });

    return Response.json(result, { status: 200, headers });
  } catch {
    return Response.json(
      CaptureErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Local connector policy is unavailable. Run pnpm db:migrate and pnpm db:seed.",
        correlationId: null,
        retryable: true
      }),
      { status: 503, headers }
    );
  } finally {
    connection?.close();
  }
}
