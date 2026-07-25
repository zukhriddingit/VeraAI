import {
  RemoteExtensionSnapshotConfirmationSchema,
  type RemoteExtensionSnapshotFailureCode
} from "@vera/domain";

import {
  createRemoteExtensionSnapshotDependencies,
  RemoteExtensionSnapshotServiceError,
  requestRemoteExtensionSnapshot
} from "../../../../../lib/remote-extension-snapshot-service.ts";
import { getHostedApplication } from "../../../../../lib/server/application.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

function failure(
  code: RemoteExtensionSnapshotFailureCode,
  status: number,
  retryable = false
): Response {
  return Response.json(
    {
      code,
      message: "The read-only remote browser snapshot did not complete.",
      retryable
    },
    { status, headers }
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers, getHostedApplication());
    if (context.demoMode) return failure("spike_disabled", 409);
    assertSameOriginMutation(request);
    const input = RemoteExtensionSnapshotConfirmationSchema.parse(
      await readBoundedJson(request, { maxBytes: 2_000 })
    );
    const result = await requestRemoteExtensionSnapshot(
      createRemoteExtensionSnapshotDependencies(context.userId, context.repositories, process.env),
      input
    );
    return Response.json(result, { status: 200, headers });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return failure("unauthorized", 401);
    if (error instanceof CrossOriginMutationError) return failure("cross_origin_request", 403);
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return failure(
        "malformed_request",
        error instanceof MutationRequestError ? error.status : 400
      );
    }
    if (error instanceof RemoteExtensionSnapshotServiceError) {
      return failure(error.code, error.status, error.retryable);
    }
    return failure("gateway_unavailable", 503, true);
  }
}
