import { CreateCurrentTabCaptureRequestSchema } from "@vera/domain";
import { MaritimeControlPlaneError } from "@vera/connectors";

import { createCurrentTabCaptureJob } from "../../../../../lib/browser-agent-service.ts";
import { getHostedApplication } from "../../../../../lib/server/application.ts";
import { dispatchHostedSourceJob } from "../../../../../lib/server/maritime-dispatch.ts";
import { parseHostedRuntimePolicy } from "../../../../../lib/server/hosted-runtime-policy.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../../lib/server/request-security.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function POST(request: Request): Promise<Response> {
  let queuedJobId: string | null = null;
  try {
    const context = await requireVeraSession(request.headers, getHostedApplication());
    if (context.demoMode) {
      return Response.json(
        {
          code: "demo_boundary",
          message: "Live browser capture is unavailable in deterministic demo mode."
        },
        { status: 409, headers }
      );
    }
    assertSameOriginMutation(request);
    const input = CreateCurrentTabCaptureRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: 32_768 })
    );
    const result = await createCurrentTabCaptureJob(
      {
        repositories: context.repositories,
        repositoryProvider: context.repositoryProvider,
        userId: context.userId,
        founderBrowserUserIds: process.env.VERA_BROWSER_FOUNDER_USER_IDS,
        systemBrowserDisabled: parseHostedRuntimePolicy(process.env).browserDisabled,
        now: () => new Date(),
        createId: crypto.randomUUID
      },
      input
    );
    queuedJobId = result.job.id;
    const dispatched = await dispatchHostedSourceJob(
      {
        userId: context.userId,
        repositories: context.repositories
      },
      result.job.id
    );
    return Response.json(
      { ...result, job: dispatched },
      { status: result.inserted ? 201 : 200, headers }
    );
  } catch (error: unknown) {
    if (error instanceof MaritimeControlPlaneError) {
      return Response.json(
        {
          code: error.code,
          message: "The capture is queued, but the Maritime worker could not be started.",
          jobId: queuedJobId
        },
        { status: error.retryable ? 503 : 409, headers }
      );
    }
    if (error instanceof MutationRequestError) {
      return Response.json(
        { code: error.code, message: "Current-tab capture request is invalid." },
        { status: error.status, headers }
      );
    }
    const status =
      error instanceof AuthenticationRequiredError
        ? 401
        : error instanceof CrossOriginMutationError
          ? 403
          : 400;
    return Response.json(
      {
        code:
          status === 401
            ? "unauthorized"
            : status === 403
              ? "cross_origin_request"
              : "capture_denied",
        message: "Current-tab capture was not queued."
      },
      { status, headers }
    );
  }
}
