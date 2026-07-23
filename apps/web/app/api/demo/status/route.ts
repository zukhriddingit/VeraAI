import { DemoUnavailableResponseSchema } from "@vera/domain";

import { DemoSearchStateError, getDemoStatus } from "../../../../lib/demo-search-service";
import { getHostedApplication } from "../../../../lib/server/application";
import { requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(request: Request): Promise<Response> {
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
    return Response.json(await getDemoStatus(context.repositories), {
      status: 200,
      headers
    });
  } catch (error: unknown) {
    const invalid = error instanceof DemoSearchStateError;
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: invalid ? "demo_state_invalid" : "demo_unavailable",
        message: invalid
          ? error.message
          : "Demo data is unavailable. Run pnpm demo:reset and pnpm demo:seed."
      }),
      { status: invalid ? 409 : 503, headers }
    );
  }
}
