import { randomUUID } from "node:crypto";

import {
  canonicalJson,
  createSqliteRepositories,
  openExistingDatabase,
  sha256Text
} from "@vera/db/runtime";
import {
  ActivityEventSchema,
  CreateDuplicateOverrideRequestSchema,
  CreateDuplicateOverrideResponseSchema,
  DecisionApiErrorResponseSchema,
  DecisionJobSummarySchema,
  DuplicateOverrideHistoryResponseSchema,
  JsonValueSchema
} from "@vera/domain";

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

export async function GET(): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    connection = openExistingDatabase();
    const repositories = createSqliteRepositories(connection);
    const profiles = repositories.searchProfiles.list();
    if (profiles.length !== 1) {
      return error(
        "database_unavailable",
        "A single active search profile is required.",
        503,
        true
      );
    }
    const overrides = repositories.duplicateOverrides.list(profiles[0]!.id);
    const revocations = repositories.duplicateOverrides.listRevocations(profiles[0]!.id);
    const activeOverrideIds = repositories.duplicateOverrides
      .listActive(profiles[0]!.id)
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
  } catch {
    return error("database_unavailable", "Duplicate override history is unavailable.", 503, true);
  } finally {
    connection?.close();
  }
}

export async function POST(request: Request): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    const body: unknown = await request.json();
    const parsed = CreateDuplicateOverrideRequestSchema.safeParse(body);
    if (!parsed.success) {
      return error("malformed_request", "The duplicate override request is malformed.", 400);
    }
    connection = openExistingDatabase();
    const repositories = createSqliteRepositories(connection);
    const profiles = repositories.searchProfiles.list();
    if (profiles.length !== 1) {
      return error(
        "database_unavailable",
        "A single active search profile is required.",
        503,
        true
      );
    }
    for (const sourceId of parsed.data.sourceRecordIds) {
      if (repositories.sourceRecords.getById(sourceId) === null) {
        return error(
          "invalid_override_reference",
          "The override references an unknown source record.",
          409
        );
      }
    }
    if (
      parsed.data.survivorCanonicalId !== null &&
      repositories.canonicalListings.getById(parsed.data.survivorCanonicalId)?.projectionState !==
        "active"
    ) {
      return error(
        "invalid_override_reference",
        "The requested survivor is not an active canonical listing.",
        409
      );
    }
    const now = new Date().toISOString();
    const payloadHash = sha256Text(canonicalJson(JsonValueSchema.parse(parsed.data)));
    const result = repositories.transaction((transactionRepositories) => {
      const override = transactionRepositories.duplicateOverrides.create({
        id: randomUUID(),
        searchProfileId: profiles[0]!.id,
        ...parsed.data,
        createdBy: "user",
        createdAt: now
      });
      const decisionJob = transactionRepositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
        id: randomUUID(),
        searchProfileId: profiles[0]!.id,
        trigger: "manual_recompute",
        now
      });
      transactionRepositories.activityEvents.append(
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
    });
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
    if (caught instanceof SyntaxError) {
      return error("malformed_request", "The duplicate override request is malformed.", 400);
    }
    return error(
      "database_unavailable",
      "The duplicate override could not be recorded.",
      503,
      true
    );
  } finally {
    connection?.close();
  }
}
