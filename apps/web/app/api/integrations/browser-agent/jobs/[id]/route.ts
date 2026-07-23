import { EntityIdSchema } from "@vera/domain";

import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly id: string }> }
): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers, getHostedApplication());
    const id = EntityIdSchema.parse((await context.params).id);
    const job = await session.repositories.sourceJobs.getById(id);
    if (!job || job.connectorId !== "zillow.current-tab.v1") {
      return Response.json(
        { code: "not_found", message: "Browser job not found." },
        { status: 404, headers }
      );
    }
    return Response.json({ job }, { headers });
  } catch (error: unknown) {
    const status = error instanceof AuthenticationRequiredError ? 401 : 400;
    return Response.json(
      {
        code: status === 401 ? "unauthorized" : "invalid_request",
        message: "Browser job is unavailable."
      },
      { status, headers }
    );
  }
}
