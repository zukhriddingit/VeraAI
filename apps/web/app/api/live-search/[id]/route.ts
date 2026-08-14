import { EntityIdSchema } from "@vera/domain";

import { getLiveSearchStatus, LiveSearchServiceError } from "../../../../lib/live-search-service";
import {
  getRentalResearchStatus,
  RentalResearchServiceError
} from "../../../../lib/rental-research-service";
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
    const { id } = await context.params;
    const runId = EntityIdSchema.parse(id);
    const events = await session.repositories.activityEvents.list();
    const isMultiSource = events.some(
      (event) => event.correlationId === runId && event.action === "rental_research_run_requested"
    );
    const status = isMultiSource
      ? await getRentalResearchStatus(runId, { repositories: session.repositories })
      : await getLiveSearchStatus(runId, { repositories: session.repositories });
    return Response.json(status, {
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
    if (error instanceof LiveSearchServiceError || error instanceof RentalResearchServiceError) {
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
