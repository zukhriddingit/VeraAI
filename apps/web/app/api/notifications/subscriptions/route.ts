import { randomUUID } from "node:crypto";

import { PushSubscriptionDataSchema } from "@vera/notifications";
import { encryptCredential, sha256Text } from "@vera/db";
import { z } from "zod";

import { getHostedApplication } from "../../../../lib/server/application.ts";
import { parseHostedRuntimePolicy } from "../../../../lib/server/hosted-runtime-policy.ts";
import { parseNotificationEnvironment } from "../../../../lib/server/notification-config.ts";
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
const failure = (code: string, status: number) =>
  Response.json(
    { code, message: "Notification subscription could not be changed." },
    { status, headers }
  );
const DeleteSchema = z.object({ endpoint: z.string().url().max(4_096) }).strict();

export async function POST(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    if (parseHostedRuntimePolicy(process.env).notificationsDisabled) {
      return failure("notifications_disabled_by_policy", 409);
    }
    const configuration = parseNotificationEnvironment();
    if (!configuration) return failure("notifications_unconfigured", 409);
    const subscription = PushSubscriptionDataSchema.parse(
      await readBoundedJson(request, { maxBytes: 16_384 })
    );
    const endpointHash = sha256Text(subscription.endpoint);
    const existing =
      await context.repositories.webPushSubscriptions.getByEndpointHash(endpointHash);
    if (existing) {
      return Response.json(
        { subscriptionId: existing.id, state: existing.status },
        { status: 200, headers }
      );
    }
    const id = randomUUID();
    const at = new Date().toISOString();
    const encryptedSubscription = await encryptCredential(
      JSON.stringify(subscription),
      { userId: context.userId, integrationId: id, provider: "web_push" },
      configuration.credentialKeyProvider
    );
    const saved = await context.repositoryProvider.transaction(
      context.userId,
      async (repositories) => {
        const record = await repositories.webPushSubscriptions.insert({
          id,
          userId: context.userId,
          endpointHash,
          encryptedSubscription,
          status: "active",
          createdAt: at,
          updatedAt: at,
          revokedAt: null
        });
        await repositories.activityEvents.append({
          id: randomUUID(),
          correlationId: randomUUID(),
          causationId: null,
          actor: "user",
          action: "notifications.web_push_subscribed",
          targetType: "web_push_subscription",
          targetId: record.id,
          policyDecision: "authorized",
          approvalId: null,
          payloadHash: endpointHash,
          outcome: "succeeded",
          errorCategory: null,
          metadata: { channel: "web_push" },
          occurredAt: at
        });
        return record;
      }
    );
    return Response.json(
      { subscriptionId: saved.id, state: saved.status },
      { status: 201, headers }
    );
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) return failure("unauthorized", 401);
    if (error instanceof CrossOriginMutationError) return failure("cross_origin_request", 403);
    if (error instanceof MutationRequestError) return failure(error.code, error.status);
    return failure("invalid_request", 400);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const input = DeleteSchema.parse(await readBoundedJson(request, { maxBytes: 16_384 }));
    const existing = await context.repositories.webPushSubscriptions.getByEndpointHash(
      sha256Text(input.endpoint)
    );
    if (existing?.status === "active") {
      await context.repositories.webPushSubscriptions.transition(
        existing.id,
        "active",
        "disabled",
        new Date().toISOString()
      );
    }
    return Response.json({ state: "disabled" }, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) return failure("unauthorized", 401);
    if (error instanceof CrossOriginMutationError) return failure("cross_origin_request", 403);
    if (error instanceof MutationRequestError) return failure(error.code, error.status);
    return failure("invalid_request", 400);
  }
}
