import { OperationsJobControlRequestSchema } from "@vera/domain";

import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import {
  OperatorAuthorizationError,
  requireOperator
} from "../../../../../../lib/server/operator-auth.ts";
import { cancelSourceJob } from "../../../../../../lib/server/operations-service.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const application = getHostedApplication();
  try {
    const session = await requireVeraSession(request.headers, application);
    requireOperator(session.userId);
    assertSameOriginMutation(request);
    const input = OperationsJobControlRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 16_384 })
    );
    const job = await cancelSourceJob({
      repositories: session.repositories,
      jobId: (await context.params).id,
      expectedRevision: input.expectedRevision,
      correlationId: input.correlationId
    });
    return Response.json(
      { id: job.id, status: job.status, attempts: job.attempts },
      { status: 200, headers }
    );
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError)
      return Response.json({ code: "unauthorized" }, { status: 401, headers });
    if (error instanceof OperatorAuthorizationError)
      return Response.json({ code: "forbidden" }, { status: 403, headers });
    if (error instanceof CrossOriginMutationError)
      return Response.json({ code: "cross_origin_request" }, { status: 403, headers });
    if (error instanceof MutationRequestError)
      return Response.json({ code: error.code }, { status: error.status, headers });
    const code =
      error instanceof Error && /^[a-z_]+$/u.test(error.message)
        ? error.message
        : "invalid_request";
    return Response.json(
      { code },
      { status: code === "job_revision_conflict" ? 409 : 400, headers }
    );
  }
}
