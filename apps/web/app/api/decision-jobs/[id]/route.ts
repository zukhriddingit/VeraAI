import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import {
  DecisionApiErrorResponseSchema,
  DecisionJobSummarySchema,
  EntityIdSchema
} from "@vera/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    const id = EntityIdSchema.safeParse((await context.params).id);
    if (!id.success) {
      return Response.json(
        DecisionApiErrorResponseSchema.parse({
          code: "not_found",
          message: "Decision job not found.",
          retryable: false
        }),
        { status: 404, headers }
      );
    }
    connection = openExistingDatabase();
    const job = createSqliteRepositories(connection).decisionJobs.getById(id.data);
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
  } catch {
    return Response.json(
      DecisionApiErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Decision job status is unavailable.",
        retryable: true
      }),
      { status: 503, headers }
    );
  } finally {
    connection?.close();
  }
}
