import { describe, expect, it } from "vitest";

import {
  CaptureAcceptedResponseSchema,
  CaptureErrorResponseSchema,
  CaptureExtractionRunSummarySchema,
  CaptureFieldSummarySchema,
  CaptureStatusResponseSchema,
  ConnectorStatusCollectionResponseSchema,
  NormalizationJobSchema
} from "./index.ts";

const createdAt = "2026-07-17T12:00:00.000Z";
const later = "2026-07-17T12:05:00.000Z";
const hash = "b".repeat(64);

const queuedJob = {
  id: "job-normalize-1",
  rawListingId: "raw-manual-1",
  idempotencyKey: hash,
  jobType: "normalize_listing",
  state: "queued",
  availableAt: createdAt,
  attempts: 0,
  maxAttempts: 3,
  leaseOwner: null,
  leaseExpiresAt: null,
  lastErrorCode: null,
  lastErrorCategory: null,
  correlationId: "correlation-capture-1",
  causationId: "event-capture-completed-1",
  createdAt,
  updatedAt: createdAt,
  completedAt: null
} as const;

describe("normalization job schema", () => {
  it("accepts queued, leased, completed, retryable, and dead-letter states", () => {
    expect(NormalizationJobSchema.parse(queuedJob).state).toBe("queued");
    expect(
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "leased",
        attempts: 1,
        leaseOwner: "worker-local-1",
        leaseExpiresAt: later,
        updatedAt: later
      }).state
    ).toBe("leased");
    expect(
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "completed",
        attempts: 1,
        completedAt: later,
        updatedAt: later
      }).state
    ).toBe("completed");
    expect(
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "retryable",
        attempts: 1,
        lastErrorCode: "normalization_failed",
        lastErrorCategory: "validation",
        updatedAt: later
      }).state
    ).toBe("retryable");
    expect(
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "dead_letter",
        attempts: 1,
        lastErrorCode: "normalization_failed",
        lastErrorCategory: "validation",
        updatedAt: later
      }).state
    ).toBe("dead_letter");
  });

  it("rejects partial leases, invalid completion, and inconsistent attempts", () => {
    expect(() =>
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "leased",
        attempts: 1,
        leaseOwner: "worker-local-1"
      })
    ).toThrow();
    expect(() =>
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "dead_letter",
        attempts: 0,
        lastErrorCode: "normalization_failed",
        lastErrorCategory: "validation"
      })
    ).toThrow();
    expect(() =>
      NormalizationJobSchema.parse({ ...queuedJob, state: "completed", attempts: 1 })
    ).toThrow();
    expect(() =>
      NormalizationJobSchema.parse({
        ...queuedJob,
        state: "retryable",
        attempts: 3,
        lastErrorCode: "normalization_failed",
        lastErrorCategory: "validation"
      })
    ).toThrow();
  });
});

describe("capture API schemas", () => {
  it("accepts bounded capture, status, connector, and error responses", () => {
    expect(
      CaptureAcceptedResponseSchema.parse({
        correlationId: queuedJob.correlationId,
        rawListingId: queuedJob.rawListingId,
        contentHash: hash,
        duplicate: false,
        normalizationJobId: queuedJob.id,
        normalizationState: "queued"
      }).duplicate
    ).toBe(false);

    expect(
      CaptureStatusResponseSchema.parse({
        correlationId: queuedJob.correlationId,
        rawListingId: queuedJob.rawListingId,
        duplicate: false,
        state: "completed",
        normalizationState: "completed",
        extractionRun: {
          mode: "deterministic_only",
          providerId: null,
          model: null,
          promptVersion: "listing-extraction.prompt.v1",
          extractionVersion: "listing-extraction.v1",
          requestedFields: ["bathrooms"],
          requestedFieldCount: 1,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          latencyMilliseconds: 0,
          repairCount: 0,
          completedAt: later
        },
        fields: [
          {
            fieldPath: "monthlyRentCents",
            status: "known",
            displayValue: "$2,450",
            unknownReason: null,
            extractionMethod: "rule",
            confidenceBasisPoints: 9_500,
            evidenceSnippet: "$2,450 per month",
            explanation: "Rule matched the labeled monthly rent."
          },
          {
            fieldPath: "bathrooms",
            status: "unknown",
            displayValue: null,
            unknownReason: "ambiguous",
            extractionMethod: "rule",
            confidenceBasisPoints: 0,
            evidenceSnippet: null,
            explanation: "The supplied evidence does not state an unambiguous bathroom count."
          }
        ],
        updatedAt: later
      }).fields
    ).toHaveLength(2);

    expect(
      ConnectorStatusCollectionResponseSchema.parse({
        connectors: [
          {
            connectorId: "manual.capture.v1",
            displayName: "Manual listing capture",
            status: "ready",
            capabilities: ["manual.capture"],
            networkAccess: false,
            detail: "Stores only content supplied by the user."
          }
        ],
        count: 1,
        generatedAt: later
      }).count
    ).toBe(1);

    expect(
      CaptureErrorResponseSchema.parse({
        code: "policy_denied",
        message: "Capture is disabled by local source policy.",
        correlationId: queuedJob.correlationId,
        retryable: false
      }).code
    ).toBe("policy_denied");
  });

  it("rejects contradictory known and unknown field summaries", () => {
    expect(() =>
      CaptureFieldSummarySchema.parse({
        fieldPath: "bathrooms",
        status: "unknown",
        displayValue: "1",
        unknownReason: "missing_evidence",
        extractionMethod: "rule",
        confidenceBasisPoints: 0,
        evidenceSnippet: null,
        explanation: "No bathroom evidence was found."
      })
    ).toThrow();
  });

  it("keeps extraction summaries internally consistent without a provider response ID", () => {
    const summary = {
      mode: "llm_augmented",
      providerId: "provider-1",
      model: "configured-model",
      promptVersion: "listing-extraction.prompt.v1",
      extractionVersion: "listing-extraction.v1",
      requestedFields: ["baseRent", "availableOn"],
      requestedFieldCount: 2,
      usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
      latencyMilliseconds: 250,
      repairCount: 1,
      completedAt: later
    } as const;

    expect(CaptureExtractionRunSummarySchema.parse(summary)).toEqual(summary);
    expect("responseId" in CaptureExtractionRunSummarySchema.parse(summary)).toBe(false);
    expect(() =>
      CaptureExtractionRunSummarySchema.parse({ ...summary, requestedFieldCount: 1 })
    ).toThrow();
    expect(() =>
      CaptureExtractionRunSummarySchema.parse({
        ...summary,
        mode: "deterministic_only",
        providerId: null,
        model: null
      })
    ).toThrow();
  });
});
