import { randomUUID } from "node:crypto";

import {
  ActivityEventSchema,
  AvailabilityRuleSetSchema,
  GetAvailabilityRulesResponseSchema,
  JsonValueSchema,
  PutAvailabilityRulesRequestSchema,
  PutAvailabilityRulesResponseSchema
} from "@vera/domain";
import { canonicalJson, sha256Text } from "@vera/db";
import { ZodError } from "zod";

import { getHostedApplication } from "../../../../lib/server/application.ts";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../lib/server/request-security.ts";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_BODY_BYTES = 16_384;
const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status, headers: responseHeaders });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers);
    const result = GetAvailabilityRulesResponseSchema.parse({
      rules: await context.repositories.availabilityRuleSets.getCurrent(),
      generatedAt: new Date().toISOString()
    });
    return Response.json(result, { status: 200, headers: responseHeaders });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }
    return errorResponse(
      "availability_unavailable",
      "Viewing availability is temporarily unavailable.",
      503
    );
  }
}

export async function PUT(request: Request): Promise<Response> {
  const application = getHostedApplication();
  try {
    const context = await requireVeraSession(request.headers, application);
    assertSameOriginMutation(request);
    const snapshot = PutAvailabilityRulesRequestSchema.parse(
      await readBoundedJson(request, { maxBytes: MAXIMUM_BODY_BYTES })
    );
    const now = new Date().toISOString();
    const result = await context.repositoryProvider.transaction(
      context.userId,
      async (repositories) => {
        const current = await repositories.availabilityRuleSets.getCurrent();
        const rules = AvailabilityRuleSetSchema.parse({
          ...snapshot,
          id: current?.id ?? randomUUID(),
          createdAt: current?.createdAt ?? now,
          updatedAt: now
        });
        const persisted = await repositories.availabilityRuleSets.upsertCurrent(rules);
        const payloadHash = sha256Text(canonicalJson(JsonValueSchema.parse(snapshot)));
        const correlationId = randomUUID();
        await repositories.activityEvents.append(
          ActivityEventSchema.parse({
            id: randomUUID(),
            correlationId,
            causationId: null,
            actor: "user",
            action: "viewing.availability_saved",
            targetType: "availability_rule_set",
            targetId: persisted.id,
            policyDecision: "not_applicable",
            approvalId: null,
            payloadHash,
            outcome: "recorded",
            errorCategory: null,
            metadata: {
              primaryCalendarOnly: true,
              state: persisted.conflictCheckingEnabled
                ? "conflict_checking_enabled"
                : "vera_rules_only"
            },
            occurredAt: now
          })
        );
        return persisted;
      }
    );
    return Response.json(PutAvailabilityRulesResponseSchema.parse({ rules: result }), {
      status: 200,
      headers: responseHeaders
    });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return errorResponse("unauthorized", "Authentication required.", 401);
    }
    if (error instanceof CrossOriginMutationError) {
      return errorResponse("cross_origin_request", "Request origin is not allowed.", 403);
    }
    if (error instanceof MutationRequestError) {
      return errorResponse("invalid_request", "Availability rules are invalid.", error.status);
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return errorResponse("invalid_request", "Availability rules are invalid.", 400);
    }
    return errorResponse(
      "availability_unavailable",
      "Viewing availability could not be saved.",
      503
    );
  }
}
