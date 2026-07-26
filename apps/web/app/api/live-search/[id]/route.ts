import { EntityIdSchema } from "@vera/domain";

import {
  assertLiveSearchFounder,
  getLiveSearchStatus,
  LiveSearchServiceError,
  parseLiveSearchEnvironment
} from "../../../../lib/live-search-service";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    assertLiveSearchFounder(session.userId, parseLiveSearchEnvironment(process.env));
    const { id } = await context.params;
    const runId = EntityIdSchema.parse(id);
    return Response.json(await getLiveSearchStatus(runId, { repositories: session.repositories }), {
      status: 200,
      headers
    });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    if (error instanceof LiveSearchServiceError) {
      return Response.json(
        { code: error.code, message: error.message },
        { status: error.status, headers }
      );
    }
    return Response.json(
      { code: "not_found", message: "Live search run was not found." },
      { status: 404, headers }
    );
  }
}
