import {
  CaptureErrorResponseSchema,
  CaptureStatusResponseSchema,
  DecisionJobSummarySchema,
  EntityIdSchema
} from "@vera/domain";

import { projectCaptureExtractionRun, projectCaptureFields } from "../../../../lib/capture-service";
import { AuthenticationRequiredError, requireVeraSession } from "../../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

interface RouteContext {
  readonly params: Promise<{ rawListingId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const generatedAt = new Date().toISOString();

  try {
    const session = await requireVeraSession(request.headers);
    const { rawListingId: rawListingIdInput } = await context.params;
    const parsedRawListingId = EntityIdSchema.safeParse(rawListingIdInput);

    if (!parsedRawListingId.success) {
      return Response.json(
        CaptureErrorResponseSchema.parse({
          code: "not_found",
          message: "The captured listing was not found.",
          correlationId: null,
          retryable: false
        }),
        { status: 404, headers }
      );
    }

    const rawListingId = parsedRawListingId.data;
    const repositories = session.repositories;
    const rawListing = await repositories.rawListings.getById(rawListingId);

    if (!rawListing) {
      return Response.json(
        CaptureErrorResponseSchema.parse({
          code: "not_found",
          message: "The captured listing was not found.",
          correlationId: null,
          retryable: false
        }),
        { status: 404, headers }
      );
    }

    const job = await repositories.normalizationJobs.getByRawListingId(rawListing.id);
    const sourceRecord = await repositories.sourceRecords.getByRawListingId(rawListing.id);
    const extractionRun = await repositories.listingExtractions.getByRawListingId(rawListing.id);
    const normalizationEvent = (
      await repositories.activityEvents.listByTarget("raw_listing", rawListing.id)
    ).find((event) => event.action === "normalization.completed");
    const decisionJobId = normalizationEvent?.metadata.decisionJobId;
    const decisionJob =
      typeof decisionJobId === "string"
        ? await repositories.decisionJobs.getById(decisionJobId)
        : null;

    if (!job && !sourceRecord) {
      return Response.json(
        CaptureErrorResponseSchema.parse({
          code: "not_found",
          message: "No normalization status exists for this capture.",
          correlationId: null,
          retryable: false
        }),
        { status: 404, headers }
      );
    }

    const state = sourceRecord
      ? decisionJob?.status === "queued" || decisionJob?.status === "retryable_failed"
        ? "decision_queued"
        : decisionJob?.status === "running"
          ? "decision_processing"
          : decisionJob?.status === "permanently_failed" || decisionJob?.status === "cancelled"
            ? "decision_failed"
            : "completed"
      : job?.state === "leased"
        ? "processing"
        : job?.state === "dead_letter"
          ? "failed"
          : "queued";
    const fields = sourceRecord
      ? projectCaptureFields({
          record: sourceRecord,
          provenance: await repositories.fieldProvenance.listBySourceRecordId(sourceRecord.id),
          extractionRun
        })
      : [];
    const response = CaptureStatusResponseSchema.parse({
      correlationId: job?.correlationId ?? rawListing.id,
      rawListingId: rawListing.id,
      duplicate: false,
      state,
      normalizationState: sourceRecord ? "completed" : (job?.state ?? "dead_letter"),
      decisionJob:
        decisionJob === null
          ? null
          : DecisionJobSummarySchema.parse({
              id: decisionJob.id,
              searchProfileId: decisionJob.searchProfileId,
              targetCorpusRevision: decisionJob.targetCorpusRevision,
              status: decisionJob.status,
              attemptCount: decisionJob.attemptCount,
              createdAt: decisionJob.createdAt,
              updatedAt: decisionJob.updatedAt,
              completedAt: decisionJob.completedAt,
              errorCode: decisionJob.errorCode
            }),
      extractionRun: projectCaptureExtractionRun(extractionRun),
      fields,
      updatedAt:
        extractionRun?.completedAt ?? job?.updatedAt ?? sourceRecord?.createdAt ?? generatedAt
    });

    return Response.json(response, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    return Response.json(
      CaptureErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Capture status is unavailable.",
        correlationId: null,
        retryable: true
      }),
      { status: 503, headers }
    );
  }
}
