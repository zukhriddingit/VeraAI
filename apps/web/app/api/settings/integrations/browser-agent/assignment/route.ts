import { getBrowserGatewayOnboardingStatus } from "../../../../../../lib/browser-gateway-onboarding-service.ts";
import { getHostedApplication } from "../../../../../../lib/server/application.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    if (!application.browserGatewayAssignments) throw new Error("assignment repository missing");
    const status = await getBrowserGatewayOnboardingStatus({
      userId: session.userId,
      assignments: application.browserGatewayAssignments,
      runtimeResolver: application.browserGatewayRuntime,
      repositories: session.repositories
    });
    return Response.json(status, { status: 200, headers });
  } catch (error: unknown) {
    return Response.json(
      {
        code: error instanceof AuthenticationRequiredError ? "unauthorized" : "unavailable",
        message: "Browser Connector onboarding status is unavailable."
      },
      { status: error instanceof AuthenticationRequiredError ? 401 : 503, headers }
    );
  }
}
