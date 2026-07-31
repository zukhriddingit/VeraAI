import {
  createLiveSearchDependencies,
  assertLiveSearchFounder,
  LiveSearchServiceError,
  parseLiveSearchEnvironment,
  runLiveSearch
} from "../../../lib/live-search-service";
import {
  createRentalResearchDependencies,
  RentalResearchServiceError,
  runRentalResearch
} from "../../../lib/rental-research-service";
import { createPersistedPolicyRegistry } from "../../../lib/connector-registry";
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

export async function POST(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    if (context.demoMode) throw new LiveSearchServiceError("disabled", 503, null, false);
    assertLiveSearchFounder(context.userId, parseLiveSearchEnvironment(process.env));
    const input = await readBoundedJson(request, { maxBytes: 2_000 });
    const policyRegistry = await createPersistedPolicyRegistry(context.repositories);
    const liveDependencies = createLiveSearchDependencies(
      context.userId,
      context.repositories,
      context.repositoryProvider,
      process.env,
      policyRegistry
    );
    const isMultiSource = typeof input === "object" && input !== null && "selectedSources" in input;
    const result = isMultiSource
      ? await runRentalResearch(
          input,
          createRentalResearchDependencies(
            context.userId,
            context.repositories,
            context.repositoryProvider,
            liveDependencies,
            process.env
          )
        )
      : await runLiveSearch(input, liveDependencies);
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
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    ) {
      return Response.json(
        { code: "malformed_request", message: "Live-search request is invalid." },
        { status: error instanceof MutationRequestError ? error.status : 400, headers }
      );
    }
    if (error instanceof LiveSearchServiceError) {
      return Response.json(
        {
          code: error.code,
          message: error.message,
          searchRunId: error.searchRunId,
          retryable: error.retryable
        },
        { status: error.status, headers }
      );
    }
    if (error instanceof RentalResearchServiceError) {
      return Response.json(
        {
          code: error.code,
          message: error.message,
          searchRunId: null,
          retryable: error.retryable
        },
        { status: error.status, headers }
      );
    }
    return Response.json(
      {
        code: "provider_unavailable",
        message: "Live search is unavailable.",
        searchRunId: null,
        retryable: true
      },
      { status: 503, headers }
    );
  }
}
