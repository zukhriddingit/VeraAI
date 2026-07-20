import {
  DEFAULT_LLM_TIMEOUT_MILLISECONDS,
  isLLMError,
  type LLMErrorCategory,
  type LLMProvider
} from "@vera/ai";
import {
  RawListingEnvelopeSchema,
  isConnectorError,
  projectListingExtraction,
  runListingExtractionPipeline,
  type ListingExtractionPipelineResult,
  type NormalizationContext,
  type NormalizationResult,
  type RawListingEnvelope
} from "@vera/connectors";
import type { VeraRepositories } from "@vera/db";
import {
  ActivityEventSchema,
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionFieldNameSchema,
  ListingExtractionRunSchema,
  type ErrorCategory,
  type JsonObject,
  type NormalizationJob
} from "@vera/domain";

export const NORMALIZATION_LEASE_DURATION_MILLISECONDS = 90_000;
const maximumRetryDelayMilliseconds = 60_000;

type PipelineRunner = typeof runListingExtractionPipeline;
type ExtractionProjector = typeof projectListingExtraction;

export interface NormalizationWorkerDependencies {
  readonly repositories: VeraRepositories;
  readonly leaseOwner: string;
  readonly provider?: LLMProvider | null;
  readonly providerTimeoutMilliseconds?: number;
  readonly runPipeline?: PipelineRunner;
  readonly projectExtraction?: ExtractionProjector;
  now(): Date;
  createId(): string;
}

export type NormalizationWorkerResult =
  | { readonly status: "idle" }
  | { readonly status: "cancelled"; readonly jobId: string }
  | {
      readonly status: "completed";
      readonly jobId: string;
      readonly mode: "deterministic_only" | "llm_augmented";
      readonly providerId: string | null;
      readonly model: string | null;
      readonly totalTokens: number;
      readonly latencyMilliseconds: number;
      readonly decisionJobId: string;
      readonly targetCorpusRevision: number;
    }
  | {
      readonly status: "retryable" | "dead_letter";
      readonly jobId: string;
      readonly errorCode: string;
      readonly errorCategory: ErrorCategory;
      readonly retryable: boolean;
    };

interface SafeFailure {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
}

class NormalizationProcessingError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;

  constructor(code: string, category: ErrorCategory, retryable: boolean) {
    super("Normalization could not safely process the immutable evidence.");
    this.name = "NormalizationProcessingError";
    this.code = code;
    this.category = category;
    this.retryable = retryable;
  }
}

function validDate(dependencies: NormalizationWorkerDependencies): Date {
  let value: Date;
  try {
    value = dependencies.now();
  } catch {
    throw new NormalizationProcessingError("normalization_invalid_clock", "internal", false);
  }
  if (Number.isNaN(value.getTime())) {
    throw new NormalizationProcessingError("normalization_invalid_clock", "internal", false);
  }
  return value;
}

function safeFailureDate(dependencies: NormalizationWorkerDependencies, fallback: Date): Date {
  try {
    return validDate(dependencies);
  } catch {
    return fallback;
  }
}

function connectorMetadata(metadata: JsonObject): {
  connectorId: unknown;
  capability: unknown;
  networkAccess: unknown;
  untrustedContent: unknown;
  browserAccess: unknown;
} {
  return {
    connectorId: metadata.connectorId,
    capability: metadata.capability,
    networkAccess: metadata.networkAccess,
    untrustedContent: metadata.untrustedContent,
    browserAccess: metadata.browserAccess
  };
}

function rawEnvelope(
  raw: NonNullable<ReturnType<VeraRepositories["rawListings"]["getById"]>>
): RawListingEnvelope {
  const metadata = connectorMetadata(raw.captureMetadata);
  return RawListingEnvelopeSchema.parse({
    connectorId: metadata.connectorId,
    capability: metadata.capability,
    source: raw.source,
    acquisitionMode: raw.acquisitionMode,
    sourceListingId: raw.sourceListingId,
    sourceUrl: raw.sourceUrl,
    captureMethod: raw.captureMethod,
    observedAt: raw.observedAt,
    sourcePostedAt: raw.sourcePostedAt,
    rawText: raw.rawText,
    rawJson: raw.rawJson,
    captureMetadata: {
      networkAccess: metadata.networkAccess,
      untrustedContent: metadata.untrustedContent,
      browserAccess: metadata.browserAccess
    }
  });
}

function llmActivityCategory(category: LLMErrorCategory): ErrorCategory {
  switch (category) {
    case "authentication":
      return "authentication";
    case "rate_limit":
      return "rate_limit";
    case "timeout":
    case "cancelled":
    case "transient_provider":
      return "transient_provider";
    case "configuration":
    case "permanent_provider":
    case "refusal":
    case "invalid_output":
      return "permanent_provider";
  }
}

function safeFailure(error: unknown): SafeFailure {
  if (isLLMError(error)) {
    return {
      code: error.code,
      category: llmActivityCategory(error.category),
      retryable: error.retryable
    };
  }
  if (error instanceof NormalizationProcessingError) {
    return { code: error.code, category: error.category, retryable: error.retryable };
  }
  if (isConnectorError(error)) {
    return { code: error.code, category: "validation", retryable: false };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return { code: "normalization_validation_failed", category: "validation", retryable: false };
  }
  return { code: "normalization_internal_error", category: "internal", retryable: true };
}

function retryAt(job: NormalizationJob, failedAt: Date): string {
  const delay = Math.min(maximumRetryDelayMilliseconds, 1_000 * 2 ** Math.max(0, job.attempts - 1));
  return new Date(failedAt.getTime() + delay).toISOString();
}

function extractionCounts(pipeline: ListingExtractionPipelineResult): {
  knownFieldCount: number;
  unknownFieldCount: number;
} {
  const fields = ListingExtractionFieldNameSchema.options.map(
    (field) => pipeline.merged.extraction[field]
  );
  const knownFieldCount = fields.filter((field) => field.status === "known").length;
  return { knownFieldCount, unknownFieldCount: fields.length - knownFieldCount };
}

function successMetadata(
  job: NormalizationJob,
  pipeline: ListingExtractionPipelineResult,
  extractionRunId: string,
  sourceRecordId: string,
  decisionJobId: string,
  targetCorpusRevision: number
): JsonObject {
  const provider = pipeline.providerResult;
  const counts = extractionCounts(pipeline);
  return {
    jobId: job.id,
    sourceRecordId,
    extractionRunId,
    mode: provider === null ? "deterministic_only" : "llm_augmented",
    providerId: provider?.providerId ?? null,
    model: provider?.model ?? null,
    promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
    extractionVersion: LISTING_EXTRACTION_VERSION,
    requestedFieldCount: pipeline.request?.fieldRequests.length ?? 0,
    knownFieldCount: counts.knownFieldCount,
    unknownFieldCount: counts.unknownFieldCount,
    inputTokens: provider?.usage.inputTokens ?? 0,
    outputTokens: provider?.usage.outputTokens ?? 0,
    totalTokens: provider?.usage.totalTokens ?? 0,
    latencyMilliseconds: provider?.latencyMilliseconds ?? 0,
    repairCount: provider?.repairCount ?? 0,
    outcomeCode: "normalization_completed",
    decisionJobId,
    targetCorpusRevision
  };
}

export async function processNextNormalizationJob(
  dependencies: NormalizationWorkerDependencies,
  signal: AbortSignal
): Promise<NormalizationWorkerResult> {
  if (signal.aborted) return { status: "idle" };

  const claimTime = validDate(dependencies);
  const job = dependencies.repositories.normalizationJobs.claimNext({
    leaseOwner: dependencies.leaseOwner,
    now: claimTime.toISOString(),
    leaseExpiresAt: new Date(
      claimTime.getTime() + NORMALIZATION_LEASE_DURATION_MILLISECONDS
    ).toISOString()
  });
  if (!job) return { status: "idle" };

  try {
    if (signal.aborted) return { status: "cancelled", jobId: job.id };
    const raw = dependencies.repositories.rawListings.getById(job.rawListingId);
    if (!raw) {
      throw new NormalizationProcessingError(
        "normalization_raw_evidence_missing",
        "conflict",
        false
      );
    }

    const envelope = rawEnvelope(raw);
    const pipeline = await (dependencies.runPipeline ?? runListingExtractionPipeline)({
      envelope,
      provider: dependencies.provider ?? null,
      signal,
      timeoutMilliseconds:
        dependencies.providerTimeoutMilliseconds ?? DEFAULT_LLM_TIMEOUT_MILLISECONDS
    });
    if (signal.aborted) return { status: "cancelled", jobId: job.id };

    const normalized: NormalizationResult = (
      dependencies.projectExtraction ?? projectListingExtraction
    )(envelope, pipeline.merged, {
      rawListingId: raw.id,
      createId: dependencies.createId,
      now: dependencies.now
    } satisfies NormalizationContext);
    const completedAt = validDate(dependencies).toISOString();
    const extractionRunId = dependencies.createId();
    const completionEventId = dependencies.createId();
    const provider = pipeline.providerResult;
    const mode = provider === null ? "deterministic_only" : "llm_augmented";
    const extractionRun = ListingExtractionRunSchema.parse({
      id: extractionRunId,
      rawListingId: raw.id,
      listingSourceRecordId: normalized.sourceRecord.id,
      mode,
      inputHash: pipeline.evidence.inputHash,
      requestedFields: pipeline.request?.fieldRequests.map((request) => request.field) ?? [],
      providerId: provider?.providerId ?? null,
      model: provider?.model ?? null,
      responseId: provider?.responseId ?? null,
      promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
      extractionVersion: LISTING_EXTRACTION_VERSION,
      providerResult: provider,
      mergedExtraction: pipeline.merged.extraction,
      usage: provider?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMilliseconds: provider?.latencyMilliseconds ?? 0,
      repairCount: provider?.repairCount ?? 0,
      completedAt
    });

    const decisionJob = dependencies.repositories.transaction((repositories) => {
      if (
        repositories.sourceRecords.getByRawListingId(raw.id) !== null ||
        repositories.listingExtractions.getByRawListingId(raw.id) !== null
      ) {
        throw new NormalizationProcessingError("normalization_result_conflict", "conflict", false);
      }

      repositories.sourceRecords.insert(normalized.sourceRecord);
      for (const provenance of normalized.provenance) {
        repositories.fieldProvenance.insert(provenance);
      }
      repositories.listingExtractions.insert(extractionRun);
      const profiles = repositories.searchProfiles.list();
      if (profiles.length !== 1) {
        throw new NormalizationProcessingError(
          "normalization_search_profile_ambiguous",
          "conflict",
          false
        );
      }
      const decisionJob = repositories.decisionJobs.bumpCorpusRevisionAndEnqueue({
        id: dependencies.createId(),
        searchProfileId: profiles[0]!.id,
        trigger: "normalization",
        now: completedAt
      });
      repositories.activityEvents.append(
        ActivityEventSchema.parse({
          id: completionEventId,
          correlationId: job.correlationId,
          causationId: job.causationId,
          actor: "system",
          action: "normalization.completed",
          targetType: "raw_listing",
          targetId: raw.id,
          policyDecision: "not_applicable",
          approvalId: null,
          payloadHash: raw.contentHash,
          outcome: "succeeded",
          errorCategory: null,
          metadata: successMetadata(
            job,
            pipeline,
            extractionRun.id,
            normalized.sourceRecord.id,
            decisionJob.id,
            decisionJob.targetCorpusRevision
          ),
          occurredAt: completedAt
        })
      );
      repositories.normalizationJobs.complete({
        id: job.id,
        leaseOwner: dependencies.leaseOwner,
        completedAt
      });
      return decisionJob;
    });

    return {
      status: "completed",
      jobId: job.id,
      mode,
      providerId: provider?.providerId ?? null,
      model: provider?.model ?? null,
      totalTokens: provider?.usage.totalTokens ?? 0,
      latencyMilliseconds: provider?.latencyMilliseconds ?? 0,
      decisionJobId: decisionJob.id,
      targetCorpusRevision: decisionJob.targetCorpusRevision
    };
  } catch (error: unknown) {
    if (signal.aborted) return { status: "cancelled", jobId: job.id };

    const failedAt = safeFailureDate(dependencies, claimTime);
    const failure = safeFailure(error);
    const failureEventId = dependencies.createId();
    const failedJob = dependencies.repositories.transaction((repositories) => {
      const updated = repositories.normalizationJobs.fail({
        id: job.id,
        leaseOwner: dependencies.leaseOwner,
        retryable: failure.retryable,
        failedAt: failedAt.toISOString(),
        retryAt: retryAt(job, failedAt),
        errorCode: failure.code,
        errorCategory: failure.category
      });
      repositories.activityEvents.append(
        ActivityEventSchema.parse({
          id: failureEventId,
          correlationId: job.correlationId,
          causationId: job.causationId,
          actor: "system",
          action: "normalization.failed",
          targetType: "raw_listing",
          targetId: job.rawListingId,
          policyDecision: "not_applicable",
          approvalId: null,
          payloadHash: job.idempotencyKey,
          outcome: "failed",
          errorCategory: failure.category,
          metadata: {
            jobId: job.id,
            errorCode: failure.code,
            errorCategory: failure.category,
            retryable: failure.retryable,
            jobState: updated.state
          },
          occurredAt: failedAt.toISOString()
        })
      );
      return updated;
    });

    return {
      status: failedJob.state === "dead_letter" ? "dead_letter" : "retryable",
      jobId: failedJob.id,
      errorCode: failure.code,
      errorCategory: failure.category,
      retryable: failure.retryable
    };
  }
}
