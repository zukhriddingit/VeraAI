import { EntityIdSchema } from "@vera/domain";

import { createPersistedPolicyRegistry } from "../../../../../lib/connector-registry";
import {
  assertLiveSearchFounder,
  createLiveSearchDependencies,
  LiveSearchServiceError,
  parseLiveSearchEnvironment
} from "../../../../../lib/live-search-service";
import {
  createRentalResearchDependencies,
  RentalResearchServiceError,
  stopRentalResearch
} from "../../../../../lib/rental-research-service";
import {
  assertSameOriginMutation,
  CrossOriginMutationError
} from "../../../../../lib/server/request-security";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    assertLiveSearchFounder(session.userId, parseLiveSearchEnvironment(process.env));
    const { id } = await context.params;
    const runId = EntityIdSchema.parse(id);
    const policyRegistry = await createPersistedPolicyRegistry(session.repositories);
    const live = createLiveSearchDependencies(
      session.userId,
      session.repositories,
      session.repositoryProvider,
      process.env,
      policyRegistry
    );
    return Response.json(
      await stopRentalResearch(
        runId,
        createRentalResearchDependencies(
          session.userId,
          session.repositories,
          session.repositoryProvider,
          live,
          process.env
        )
      ),
      { status: 200, headers }
    );
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
    if (error instanceof LiveSearchServiceError || error instanceof RentalResearchServiceError) {
      return Response.json(
        { code: error.code, message: error.message },
        { status: error.status, headers }
      );
    }
    return Response.json(
      { code: "not_found", message: "Rental research run was not found." },
      { status: 404, headers }
    );
  }
}
