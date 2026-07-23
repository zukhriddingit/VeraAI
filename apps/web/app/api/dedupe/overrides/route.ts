import { randomUUID } from "node:crypto";

import { canonicalJson, sha256Text } from "@vera/db";
import {
  ActivityEventSchema,
  CreateDuplicateOverrideRequestSchema,
  CreateDuplicateOverrideResponseSchema,
  DecisionApiErrorResponseSchema,
  DecisionJobSummarySchema,
  DuplicateOverrideHistoryResponseSchema,
  JsonValueSchema
} from "@vera/domain";
import {
  assertSameOriginMutation,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "../../../../lib/server/request-security.ts";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

function error(
  code: "malformed_request" | "invalid_override_reference" | "database_unavailable",
  message: string,
  status: number,
  retryable = false
) {
  return Response.json(DecisionApiErrorResponseSchema.parse({ code, message, retryable }), {
    status,
    headers
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    const repositories = session.repositories;
    const profiles = await repositories.searchProfiles.list();
    if (profiles.length !== 1) {
      return error(
        "database_unavailable",
        "A single active search profile is required.",
        503,
        true
      );
    }
    const overrides = await repositories.duplicateOverrides.list(profiles[0]!.id);
    const revocations = await repositories.duplicateOverrides.listRevocations(profiles[0]!.id);
    const activeOverrideIds = (await repositories.duplicateOverrides.listActive(profiles[0]!.id))
      .map(({ id }) => id)
      .sort();
    return Response.json(
      DuplicateOverrideHistoryResponseSchema.parse({
        overrides,
        revocations,
        activeOverrideIds,
        generatedAt: new Date().toISOString()
      }),
      { status: 200, headers }
    );
  } catch (caught: unknown) {
    if (caught instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    return error("database_unavailable", "Duplicate override history is unavailable.", 503, true);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireVeraSession(request.headers);
    assertSameOriginMutation(request);
    const body = await readBoundedJson(request, { maxBytes: 16_384 });
    const parsed = CreateDuplicateOverrideRequestSchema.safeParse(body);
    if (!parsed.success) {
      return error("malformed_request", "The duplicate override request is malformed.", 400);
    }
    const repositories = session.repositories;
    const profiles = await repositories.searchProfiles.list();
    if (profiles.length !== 1) {
      return error(
        "database_unavailable",
        "A single active search profile is required.",
        503,
        true
      );
    }
    for (const sourceId of parsed.data.sourceRecordIds) {
      if ((await repositories.sourceRecords.getById(sourceId)) === null) {
        return error(
          "invalid_override_reference",
          "The override references an unknown source record.",
          409
        );
      }
    }
    if (
      parsed.data.survivorCanonicalId !== null &&
      (await repositories.canonicalListings.getById(parsed.data.survivorCanonicalId))
        ?.projectionState !== "active"
    ) {
      return error(
        "invalid_override_reference",
        "The requested survivor is not an active canonical listing.",
        409
      );
    }
    const now = new Date().toISOString();
    const payloadHash = sha256Text(canonicalJson(JsonValueSchema.parse(parsed.data)));
    const result = await session.repositoryProvider.transaction(
      session.userId,
      async (transactionRepositories) => {
        const override = await transactionRepositories.duplicateOverrides.create({
          id: randomUUID(),
          searchProfileId: profiles[0]!.id,
          ...parsed.data,
          createdBy: "user",
          createdAt: now
        });
        const decisionJob = await transactionRepositories.decisionJobs.bumpCorpusRevisionAndEnqueue(
          {
            id: randomUUID(),
            searchProfileId: profiles[0]!.id,
            trigger: "manual_recompute",
            now
          }
        );
        await transactionRepositories.activityEvents.append(
          ActivityEventSchema.parse({
            id: randomUUID(),
            correlationId: decisionJob.id,
            causationId: null,
            actor: "user",
            action: "duplicate.override_created",
            targetType: "duplicate_override",
            targetId: override.id,
            policyDecision: "not_applicable",
            approvalId: null,
            payloadHash,
            outcome: "succeeded",
            errorCategory: null,
            metadata: {
              kind: override.kind,
              sourceRecordCount: override.sourceRecordIds.length,
              decisionJobId: decisionJob.id,
              targetCorpusRevision: decisionJob.targetCorpusRevision
            },
            occurredAt: now
          })
        );
        return { override, decisionJob };
      }
    );
    return Response.json(
      CreateDuplicateOverrideResponseSchema.parse({
        override: result.override,
        decisionJob: DecisionJobSummarySchema.parse({
          id: result.decisionJob.id,
          searchProfileId: result.decisionJob.searchProfileId,
          targetCorpusRevision: result.decisionJob.targetCorpusRevision,
          status: result.decisionJob.status,
          attemptCount: result.decisionJob.attemptCount,
          createdAt: result.decisionJob.createdAt,
          updatedAt: result.decisionJob.updatedAt,
          completedAt: result.decisionJob.completedAt,
          errorCode: result.decisionJob.errorCode
        })
      }),
      { status: 202, headers }
    );
  } catch (caught: unknown) {
    if (caught instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    if (caught instanceof CrossOriginMutationError) {
      return error("malformed_request", "Request origin is not allowed.", 403);
    }
    if (caught instanceof MutationRequestError) {
      return error(
        "malformed_request",
        "The duplicate override request is malformed.",
        caught.status
      );
    }
    return error(
      "database_unavailable",
      "The duplicate override could not be recorded.",
      503,
      true
    );
  }
}
