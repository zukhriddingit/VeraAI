import { BrowserControlMutationSchema } from "@vera/domain";

import { mutateBrowserControls } from "../../../../../lib/browser-agent-service.ts";
import { getHostedApplication } from "../../../../../lib/server/application.ts";
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

export async function PATCH(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers, getHostedApplication());
    assertSameOriginMutation(request);
    const input = BrowserControlMutationSchema.parse(
      await readBoundedJson(request, { maxBytes: 16_384 })
    );
    const result = await mutateBrowserControls(
      {
        repositories: context.repositories,
        systemBrowserDisabled: parseHostedRuntimePolicy(process.env).browserDisabled,
        now: () => new Date(),
        createId: crypto.randomUUID
      },
      input
    );
    return Response.json(result, { headers });
  } catch (error: unknown) {
    if (error instanceof MutationRequestError) {
      return Response.json(
        { code: error.code, message: "Browser control request is invalid." },
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
              : "invalid_browser_control",
        message: "Browser control was not changed."
      },
      { status, headers }
    );
  }
}
