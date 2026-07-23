import { randomUUID } from "node:crypto";

import { CaptureErrorResponseSchema, type CaptureErrorCode } from "@vera/domain";

import { captureListing, CaptureServiceError } from "../../../lib/capture-service";
import {
  createPersistedPolicyRegistry,
  listSourceConnectors
} from "../../../lib/connector-registry";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../lib/server/request-security";
import { AuthenticationRequiredError, requireVeraSession } from "../../../lib/server/session";

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
  try {
    const context = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    const input = await readBoundedJson(request, { maxBytes: maximumRequestBytes });
    const result = await captureListing(input, {
      userId: context.userId,
      repositoryProvider: context.repositoryProvider,
      repositories: context.repositories,
      connectors: listSourceConnectors(),
      policyRegistry: await createPersistedPolicyRegistry(context.repositories),
      now: () => new Date(),
      createId: randomUUID
    });

    return Response.json(result, { status: 202, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    if (error instanceof CrossOriginMutationError) {
      return Response.json(
        { code: "cross_origin_request", message: "Request origin is not allowed." },
        { status: 403, headers }
      );
    }
    if (error instanceof MutationRequestError) {
      return Response.json(
        CaptureErrorResponseSchema.parse({
          code: "malformed_request",
          message: "Capture request is invalid.",
          correlationId: null,
          retryable: false
        }),
        { status: error.status, headers }
      );
    }
    const code: CaptureErrorCode =
      error instanceof CaptureServiceError ? error.code : "database_unavailable";
    const response = CaptureErrorResponseSchema.parse({
      code,
      message:
        error instanceof CaptureServiceError
          ? error.message
          : "Capture data is unavailable. Check PostgreSQL readiness.",
      correlationId: error instanceof CaptureServiceError ? error.correlationId : null,
      retryable: error instanceof CaptureServiceError ? error.retryable : true
    });

    return Response.json(response, { status: statusFor(code), headers });
  }
}
