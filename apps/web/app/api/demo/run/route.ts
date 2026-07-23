import { DemoUnavailableResponseSchema } from "@vera/domain";

import { DemoSearchStateError, runDemoSearch } from "../../../../lib/demo-search-service";
import { getHostedApplication } from "../../../../lib/server/application";
import {
  assertSameOriginMutation,
  CrossOriginMutationError
} from "../../../../lib/server/request-security";
import { requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function POST(request: Request): Promise<Response> {
  const application = getHostedApplication();
  if (application.mode !== "demo") {
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: "demo_mode_disabled",
        message: "Demo mode is not enabled."
      }),
      { status: 404, headers }
    );
  }

  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const result = await runDemoSearch({
      userId: context.userId,
      repositoryProvider: context.repositoryProvider,
      repositories: context.repositories,
      now: () => new Date()
    });
    return Response.json(result, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof CrossOriginMutationError) {
      return Response.json(
        DemoUnavailableResponseSchema.parse({
          code: "demo_unavailable",
          message: "Request origin is not allowed."
        }),
        { status: 403, headers }
      );
    }
    const invalid = error instanceof DemoSearchStateError;
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: invalid ? "demo_state_invalid" : "demo_unavailable",
        message: invalid
          ? error.message
          : "Demo search failed safely. Reset and seed the deterministic demo before retrying."
      }),
      { status: invalid ? 409 : 503, headers }
    );
  }
}
