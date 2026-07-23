import { CaptureErrorResponseSchema, ConnectorStatusCollectionResponseSchema } from "@vera/domain";

import {
  createPersistedPolicyRegistry,
  listSourceConnectors
} from "../../../lib/connector-registry";
import { AuthenticationRequiredError, requireVeraSession } from "../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function GET(request: Request): Promise<Response> {
  const generatedAt = new Date().toISOString();

  try {
    const context = await requireVeraSession(request.headers);
    const registry = await createPersistedPolicyRegistry(context.repositories);
    const connectors = listSourceConnectors().map((connector) => connector.health(registry));
    const result = ConnectorStatusCollectionResponseSchema.parse({
      connectors,
      count: connectors.length,
      generatedAt
    });

    return Response.json(result, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    return Response.json(
      CaptureErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Connector policy is unavailable. Check PostgreSQL readiness.",
        correlationId: null,
        retryable: true
      }),
      { status: 503, headers }
    );
  }
}
