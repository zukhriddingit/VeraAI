import { randomUUID } from "node:crypto";

import { CaptureErrorResponseSchema, type CaptureErrorCode } from "@vera/domain";
import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";

import { captureListing, CaptureServiceError } from "../../../lib/capture-service";
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
const maximumRequestBytes = 260_000;

function statusFor(code: CaptureErrorCode): number {
  if (code === "policy_denied") return 403;
  if (code === "unsupported_source") return 422;
  if (code === "database_unavailable") return 503;
  return 400;
}

export async function POST(request: Request): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;

  try {
    const rawBody = await request.text();
    const input: unknown =
      rawBody.length > maximumRequestBytes
        ? null
        : (() => {
            try {
              return JSON.parse(rawBody) as unknown;
            } catch {
              return rawBody;
            }
          })();
    connection = openExistingDatabase();
    const repositories = createSqliteRepositories(connection);
    const result = captureListing(input, {
      repositories,
      connectors: listSourceConnectors(),
      policyRegistry: createPersistedPolicyRegistry(repositories),
      now: () => new Date(),
      createId: randomUUID
    });

    return Response.json(result, { status: 202, headers });
  } catch (error: unknown) {
    const code: CaptureErrorCode =
      error instanceof CaptureServiceError ? error.code : "database_unavailable";
    const response = CaptureErrorResponseSchema.parse({
      code,
      message:
        error instanceof CaptureServiceError
          ? error.message
          : "Local capture data is unavailable. Run pnpm db:migrate and pnpm db:seed.",
      correlationId: error instanceof CaptureServiceError ? error.correlationId : null,
      retryable: error instanceof CaptureServiceError ? error.retryable : true
    });

    return Response.json(response, { status: statusFor(code), headers });
  } finally {
    connection?.close();
  }
}
