import { DecisionApiErrorResponseSchema, DecisionJobSummarySchema } from "@vera/domain";

import { parseRouteEntityId } from "../../../../lib/route-entity-id";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    const id = parseRouteEntityId((await context.params).id);
    if (id === null) {
      return Response.json(
        DecisionApiErrorResponseSchema.parse({
          code: "not_found",
          message: "Decision job not found.",
          retryable: false
        }),
        { status: 404, headers }
      );
    }
    const job = await session.repositories.decisionJobs.getById(id);
    if (job === null) {
      return Response.json(
        DecisionApiErrorResponseSchema.parse({
          code: "not_found",
          message: "Decision job not found.",
          retryable: false
        }),
        { status: 404, headers }
      );
    }
    return Response.json(
      DecisionJobSummarySchema.parse({
        id: job.id,
        searchProfileId: job.searchProfileId,
        targetCorpusRevision: job.targetCorpusRevision,
        status: job.status,
        attemptCount: job.attemptCount,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
        errorCode: job.errorCode
      }),
      { status: 200, headers }
    );
  } catch (caught: unknown) {
    if (caught instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    return Response.json(
      DecisionApiErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Decision job status is unavailable.",
        retryable: true
      }),
      { status: 503, headers }
    );
  }
}
