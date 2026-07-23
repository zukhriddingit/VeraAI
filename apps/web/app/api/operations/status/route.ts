import { getHostedApplication } from "../../../../lib/server/application.ts";
import {
  OperatorAuthorizationError,
  requireOperator
} from "../../../../lib/server/operator-auth.ts";
import { loadOperationsSnapshot } from "../../../../lib/server/operations-service.ts";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    requireOperator(context.userId);
    const snapshot = await loadOperationsSnapshot({
      repositories: context.repositories,
      ...(application.maritimeOperations
        ? { globalOperations: application.maritimeOperations }
        : {})
    });
    return Response.json(snapshot, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError)
      return Response.json({ code: "unauthorized" }, { status: 401, headers });
    if (error instanceof OperatorAuthorizationError)
      return Response.json({ code: "forbidden" }, { status: 403, headers });
    return Response.json({ code: "operations_unavailable" }, { status: 503, headers });
  }
}
