import { EntityIdSchema } from "@vera/domain";

import { createPersistedPolicyRegistry } from "../../../../../lib/connector-registry";
import {
  createLiveSearchDependencies,
  LiveSearchServiceError
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
import { getHostedApplication } from "../../../../../lib/server/application";

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
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
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
    const browserRuntime =
      (await application.browserGatewayRuntime?.resolveForUser(session.userId)) ?? null;
    return Response.json(
      await stopRentalResearch(
        runId,
        createRentalResearchDependencies(
          session.userId,
          session.repositories,
          session.repositoryProvider,
          live,
          browserRuntime,
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
