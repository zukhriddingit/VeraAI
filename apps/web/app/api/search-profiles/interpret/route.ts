import { DEFAULT_LLM_TIMEOUT_MILLISECONDS, type SearchIntentProvider } from "@vera/ai";
import {
  SearchIntentInterpretRequestSchema,
  SearchIntentInterpretResponseSchema
} from "@vera/domain";

import {
  createEnvironmentSearchIntentProvider,
  interpretSearchIntent,
  SearchProfileServiceError
} from "../../../../lib/search-profile-service";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../lib/server/request-security";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export interface InterpretSearchIntentRouteDependencies {
  readonly providerFactory?: (
    environment: Readonly<Record<string, string | undefined>>
  ) => SearchIntentProvider | null;
}

export function createInterpretSearchIntentHandler(
  dependencies: InterpretSearchIntentRouteDependencies = {}
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const context = await requireVeraSession(request.headers);
      assertSameOriginMutation(request);
      if (context.demoMode) {
        throw new SearchProfileServiceError("interpretation_unavailable", 503);
      }
      const input = SearchIntentInterpretRequestSchema.parse(
        await readBoundedJson(request, { maxBytes: 2_100 })
      );
      if (new TextEncoder().encode(input.description).byteLength > 2_000) {
        throw new MutationRequestError("payload_too_large", 413);
      }
      const providerFactory = dependencies.providerFactory ?? createEnvironmentSearchIntentProvider;
      const draft = await interpretSearchIntent(input, {
        provider: providerFactory(process.env),
        signal: request.signal,
        timeoutMilliseconds: DEFAULT_LLM_TIMEOUT_MILLISECONDS
      });
      return Response.json(SearchIntentInterpretResponseSchema.parse({ draft }), {
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
          { code: "malformed_request", message: "Search description is invalid." },
          { status: error instanceof MutationRequestError ? error.status : 400, headers }
        );
      }
      if (error instanceof SearchProfileServiceError) {
        return Response.json(
          { code: error.code, message: error.message },
          { status: error.status, headers }
        );
      }
      return Response.json(
        {
          code: "interpretation_unavailable",
          message: "Search interpretation is unavailable. Enter the filters manually."
        },
        { status: 503, headers }
      );
    }
  };
}

export const POST = createInterpretSearchIntentHandler();
