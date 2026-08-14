import { createHash, randomUUID } from "node:crypto";

import { BetaAccessReviewSchema } from "@vera/domain";
import { z } from "zod";

import { getHostedApplication } from "../../../../lib/server/application.ts";
import {
  BetaAdminRequiredError,
  requireBetaAdmin
} from "../../../../lib/server/beta-admin-auth.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../lib/server/request-security.ts";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };
const RequestIdSchema = z.uuid();

export async function GET(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    requireBetaAdmin(session.userId);
    if (!application.betaAccess) throw new Error("Beta access repository is unavailable.");
    return Response.json({ requests: await application.betaAccess.listRequests() }, { headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError)
      return Response.json({ code: "unauthorized" }, { status: 401, headers });
    if (error instanceof BetaAdminRequiredError)
      return Response.json({ code: "not_found" }, { status: 404, headers });
    return Response.json({ code: "unavailable" }, { status: 503, headers });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    requireBetaAdmin(session.userId);
    assertSameOriginMutation(request);
    const input = z
      .object({ requestId: RequestIdSchema })
      .extend(BetaAccessReviewSchema.shape)
      .strict()
      .parse(await readBoundedJson(request, { maxBytes: 4_096 }));
    if (!application.betaAccess) throw new Error("Beta access repository is unavailable.");
    const reviewed = await application.betaAccess.review({
      requestId: input.requestId,
      action: input.action,
      reviewerUserId: session.userId,
      now: new Date()
    });
    const eventId = randomUUID();
    await session.repositories.activityEvents.append({
      id: eventId,
      correlationId: eventId,
      causationId: null,
      actor: "user",
      action: `beta_access.${input.action}`,
      targetType: "beta_access_request",
      targetId: input.requestId,
      policyDecision: "authorized",
      approvalId: null,
      payloadHash: createHash("sha256")
        .update(`${input.requestId}:${input.action}`, "utf8")
        .digest("hex"),
      outcome: "succeeded",
      errorCategory: null,
      metadata: { action: input.action },
      occurredAt: new Date().toISOString()
    });
    return Response.json({ request: reviewed }, { headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError)
      return Response.json({ code: "unauthorized" }, { status: 401, headers });
    if (error instanceof BetaAdminRequiredError)
      return Response.json({ code: "not_found" }, { status: 404, headers });
    if (error instanceof CrossOriginMutationError)
      return Response.json({ code: "cross_origin_request" }, { status: 403, headers });
    if (
      error instanceof MutationRequestError ||
      (error instanceof Error && error.name === "ZodError")
    )
      return Response.json(
        { code: "invalid_request" },
        { status: error instanceof MutationRequestError ? error.status : 400, headers }
      );
    return Response.json({ code: "conflict" }, { status: 409, headers });
  }
}
