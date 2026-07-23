import { getBrowserAgentStatus } from "../../../../../lib/browser-agent-service.ts";
import { getHostedApplication } from "../../../../../lib/server/application.ts";
import { parseHostedRuntimePolicy } from "../../../../../lib/server/hosted-runtime-policy.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers, getHostedApplication());
    const result = await getBrowserAgentStatus({
      repositories: context.repositories,
      systemBrowserDisabled: parseHostedRuntimePolicy(process.env).browserDisabled,
      now: () => new Date(),
      createId: crypto.randomUUID
    });
    return Response.json(result, { headers });
  } catch (error: unknown) {
    const status = error instanceof AuthenticationRequiredError ? 401 : 400;
    return Response.json(
      {
        code: status === 401 ? "unauthorized" : "browser_status_unavailable",
        message: "Browser-agent status is unavailable."
      },
      { status, headers }
    );
  }
}
