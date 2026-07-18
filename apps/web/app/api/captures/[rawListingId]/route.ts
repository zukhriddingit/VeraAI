import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import {
  CaptureErrorResponseSchema,
  CaptureStatusResponseSchema,
  EntityIdSchema
} from "@vera/domain";

import { projectCaptureExtractionRun, projectCaptureFields } from "../../../../lib/capture-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

interface RouteContext {
  readonly params: Promise<{ rawListingId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const generatedAt = new Date().toISOString();
  let connection: ReturnType<typeof openExistingDatabase> | null = null;

  try {
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
    connection = openExistingDatabase();
    const repositories = createSqliteRepositories(connection);
    const rawListing = repositories.rawListings.getById(rawListingId);

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

    const job = repositories.normalizationJobs.getByRawListingId(rawListing.id);
    const sourceRecord = repositories.sourceRecords.getByRawListingId(rawListing.id);
    const extractionRun = repositories.listingExtractions.getByRawListingId(rawListing.id);

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
      ? "completed"
      : job?.state === "leased"
        ? "processing"
        : job?.state === "dead_letter"
          ? "failed"
          : "queued";
    const fields = sourceRecord
      ? projectCaptureFields({
          record: sourceRecord,
          provenance: repositories.fieldProvenance.listBySourceRecordId(sourceRecord.id),
          extractionRun
        })
      : [];
    const response = CaptureStatusResponseSchema.parse({
      correlationId: job?.correlationId ?? rawListing.id,
      rawListingId: rawListing.id,
      duplicate: false,
      state,
      normalizationState: sourceRecord ? "completed" : (job?.state ?? "dead_letter"),
      extractionRun: projectCaptureExtractionRun(extractionRun),
      fields,
      updatedAt:
        extractionRun?.completedAt ?? job?.updatedAt ?? sourceRecord?.createdAt ?? generatedAt
    });

    return Response.json(response, { status: 200, headers });
  } catch {
    return Response.json(
      CaptureErrorResponseSchema.parse({
        code: "database_unavailable",
        message: "Local capture status is unavailable.",
        correlationId: null,
        retryable: true
      }),
      { status: 503, headers }
    );
  } finally {
    connection?.close();
  }
}
