import { NotificationPreferenceSchema } from "@vera/domain";
import { z } from "zod";

import { getHostedApplication } from "../../../../lib/server/application.ts";
import { parseHostedRuntimePolicy } from "../../../../lib/server/hosted-runtime-policy.ts";
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
    { code, message: "Notification preferences could not be changed." },
    { status, headers }
  );
const UpdateSchema = NotificationPreferenceSchema.pick({
  enabled: true,
  scoreThreshold: true,
  freshnessMinutes: true,
  riskCeiling: true,
  timezone: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  hourlyLimit: true,
  digestEnabled: true
}).strict();

export async function GET(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    const preference = await context.repositories.notificationPreferences.get();
    return Response.json({ preference }, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) return failure("unauthorized", 401);
    return failure("invalid_request", 400);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const update = UpdateSchema.parse(await readBoundedJson(request, { maxBytes: 16_384 }));
    if (update.enabled && parseHostedRuntimePolicy(process.env).notificationsDisabled) {
      return failure("notifications_disabled_by_policy", 409);
    }
    const existing = await context.repositories.notificationPreferences.get();
    const at = new Date().toISOString();
    const preference = NotificationPreferenceSchema.parse({
      ...update,
      userId: context.userId,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at
    });
    const saved = await context.repositoryProvider.transaction(
      context.userId,
      async (repositories) => {
        const stored = await repositories.notificationPreferences.upsert(preference);
        const scheduleId = "notification-fanout-v1";
        const existingSchedule = await repositories.productionSchedules.getById(scheduleId);
        await repositories.productionSchedules.upsert({
          id: scheduleId,
          userId: context.userId,
          kind: "notification_fanout",
          state: stored.enabled ? "enabled" : "disabled_by_policy",
          intervalSeconds: 60,
          sourceConfigurationId: null,
          nextRunAt: new Date(Date.parse(at) + 60_000).toISOString(),
          lastRunAt: existingSchedule?.lastRunAt ?? null,
          createdAt: existingSchedule?.createdAt ?? at,
          updatedAt: at
        });
        return stored;
      }
    );
    return Response.json({ preference: saved }, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) return failure("unauthorized", 401);
    if (error instanceof CrossOriginMutationError) return failure("cross_origin_request", 403);
    if (error instanceof MutationRequestError) return failure(error.code, error.status);
    if (error instanceof z.ZodError) return failure("invalid_request", 400);
    return failure("invalid_request", 400);
  }
}
