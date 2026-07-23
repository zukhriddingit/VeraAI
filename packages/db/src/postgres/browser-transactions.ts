import {
  BrowserCaptureAcceptanceSchema,
  BrowserProfileIdSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  SafeBrowserUrlSchema,
  Sha256Schema,
  type BrowserCaptureAcceptance,
  type VeraUserId
} from "@vera/domain";
import { z } from "zod";

import { sha256Text } from "../hashing.ts";
import type {
  AcceptBrowserCaptureInput,
  AcceptBrowserCaptureResult,
  UserRepositoryProvider
} from "../repositories.ts";

const AcceptBrowserCaptureInputSchema = z
  .object({
    sourceJobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    nodeId: EntityIdSchema,
    profileId: BrowserProfileIdSchema,
    payloadHash: Sha256Schema,
    invocationIdempotencyKey: Sha256Schema,
    resultHash: Sha256Schema,
    contentHash: Sha256Schema,
    canonicalUrl: SafeBrowserUrlSchema,
    pageTitle: z.string().trim().min(1).max(500),
    renderedText: z.string().trim().min(1).max(250_000),
    structuredMetadata: z.record(
      z.string().trim().min(1).max(80),
      z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()])
    ),
    observedAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema
  })
  .strict();

function zillowSourceListingId(canonicalUrl: string): string {
  const match = new URL(canonicalUrl).pathname.match(/\/(\d+)_zpid\/$/u);
  if (!match?.[1]) throw new Error("The accepted Zillow URL has no stable listing identifier.");
  return match[1];
}

function stableId(prefix: string, hash: string): string {
  return `${prefix}-${hash.slice(0, 32)}`;
}

function assertSameAcceptance(
  existing: BrowserCaptureAcceptance,
  input: z.infer<typeof AcceptBrowserCaptureInputSchema>
): void {
  if (
    existing.attemptId !== input.attemptId ||
    existing.nodeId !== input.nodeId ||
    existing.profileId !== input.profileId ||
    existing.payloadHash !== input.payloadHash ||
    existing.invocationIdempotencyKey !== input.invocationIdempotencyKey ||
    existing.resultHash !== input.resultHash ||
    existing.contentHash !== input.contentHash ||
    existing.canonicalUrl !== input.canonicalUrl
  ) {
    throw new Error("The browser capture replay does not match the immutable accepted result.");
  }
}

export async function acceptBrowserCapture(
  repositoryProvider: UserRepositoryProvider,
  userId: VeraUserId,
  inputValue: AcceptBrowserCaptureInput
): Promise<AcceptBrowserCaptureResult> {
  const input = AcceptBrowserCaptureInputSchema.parse(inputValue);
  return repositoryProvider.transaction(userId, async (repositories) => {
    const job = await repositories.sourceJobs.getById(input.sourceJobId);
    if (!job) throw new Error("The source job does not exist for this user.");
    const existing = await repositories.browserCaptureAcceptances.getBySourceJobId(job.id);
    if (existing) {
      assertSameAcceptance(existing, input);
      const rawListing = await repositories.rawListings.getById(existing.rawListingId);
      if (!rawListing) throw new Error("Accepted browser capture is missing its raw listing.");
      return { acceptance: existing, rawListing, replayed: true };
    }

    if (job.status !== "running") throw new Error("Only a running source job can accept output.");
    if (
      job.connectorId !== "zillow.current-tab.v1" ||
      job.source !== "zillow" ||
      job.acquisitionMode !== "local_browser" ||
      job.operation !== "capture.current_tab" ||
      job.payload.acquisitionMode !== "local_browser" ||
      job.payload.captureKind !== "current_tab"
    ) {
      throw new Error("The source job is not a Zillow current-tab capture.");
    }
    if (
      job.payload.nodeId !== input.nodeId ||
      job.payload.profileId !== input.profileId ||
      job.payload.canonicalUrl !== input.canonicalUrl ||
      job.payloadHash !== input.payloadHash
    ) {
      throw new Error("Browser capture identity does not match the claimed source job.");
    }

    const attempt = (await repositories.sourceJobAttempts.listByJobId(job.id)).find(
      (candidate) => candidate.id === input.attemptId
    );
    if (
      !attempt ||
      attempt.outcomeStatus !== "completed" ||
      attempt.correlationId !== job.correlationId ||
      attempt.payloadHash !== job.payloadHash
    ) {
      throw new Error("Browser capture acceptance requires its completed matching attempt.");
    }
    const node = await repositories.browserNodes.getById(input.nodeId);
    if (!node || node.providerId !== "openclaw-2026.6.33") {
      throw new Error("The accepted capture must come from the selected OpenClaw node.");
    }
    const profile = await repositories.browserProfileControls.get(input.nodeId, input.profileId);
    if (!profile || profile.disabledAt !== null) {
      throw new Error("The selected browser profile is absent or disabled.");
    }

    const expectedContentHash = sha256Text(
      JSON.stringify({
        canonicalUrl: input.canonicalUrl,
        pageTitle: input.pageTitle,
        renderedText: input.renderedText
      })
    );
    if (expectedContentHash !== input.contentHash) {
      throw new Error("Browser capture content hash does not match its bounded evidence.");
    }

    const rawListingId = stableId("raw-browser", input.resultHash);
    const rawImport = await repositories.rawListings.import({
      id: rawListingId,
      source: "zillow",
      acquisitionMode: "local_browser",
      sourceListingId: zillowSourceListingId(input.canonicalUrl),
      sourceUrl: input.canonicalUrl,
      captureMethod: "local_browser",
      observedAt: input.observedAt,
      sourcePostedAt: null,
      rawText: input.renderedText,
      rawJson: {
        canonicalUrl: input.canonicalUrl,
        pageTitle: input.pageTitle,
        structuredMetadata: input.structuredMetadata
      },
      captureMetadata: {
        captureKind: "current_tab",
        connectorId: job.connectorId,
        correlationId: job.correlationId,
        sourceJobId: job.id,
        attemptId: attempt.id,
        contentHash: input.contentHash
      }
    });

    const acceptance = BrowserCaptureAcceptanceSchema.parse({
      id: stableId("browser-acceptance", input.resultHash),
      sourceJobId: job.id,
      attemptId: attempt.id,
      nodeId: input.nodeId,
      profileId: input.profileId,
      payloadHash: input.payloadHash,
      invocationIdempotencyKey: input.invocationIdempotencyKey,
      resultHash: input.resultHash,
      contentHash: input.contentHash,
      canonicalUrl: input.canonicalUrl,
      rawListingId: rawImport.record.id,
      acceptedAt: input.acceptedAt
    });
    await repositories.browserCaptureAcceptances.insert(acceptance);
    await repositories.browserNodes.upsert({
      ...node,
      lastSuccessfulCaptureAt: input.acceptedAt,
      updatedAt: input.acceptedAt
    });

    const normalizationIdempotencyKey = sha256Text(
      `normalize-browser-capture:v1:${rawImport.record.id}`
    );
    await repositories.normalizationJobs.enqueue({
      id: stableId("normalize-browser", normalizationIdempotencyKey),
      rawListingId: rawImport.record.id,
      idempotencyKey: normalizationIdempotencyKey,
      availableAt: input.acceptedAt,
      maxAttempts: 3,
      correlationId: job.correlationId,
      causationId: job.id,
      createdAt: input.acceptedAt
    });

    for (const [index, event] of [
      { action: "browser.result_accepted", targetType: "source_job", targetId: job.id },
      {
        action: "browser.ingestion_completed",
        targetType: "raw_listing",
        targetId: rawImport.record.id
      }
    ].entries()) {
      await repositories.activityEvents.append({
        id: stableId(`activity-browser-${index + 1}`, input.resultHash),
        correlationId: job.correlationId,
        causationId: job.id,
        actor: "system",
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        policyDecision: "authorized",
        approvalId: job.approvalId,
        payloadHash: job.payloadHash,
        outcome: "succeeded",
        errorCategory: null,
        metadata: {
          connectorId: job.connectorId,
          resultHash: input.resultHash,
          contentHash: input.contentHash,
          replayedRawImport: !rawImport.inserted
        },
        occurredAt: input.acceptedAt
      });
    }

    await repositories.sourceJobs.transition(job.id, "completed", input.acceptedAt, {
      attempts: job.attempts,
      result: {
        jobId: job.id,
        connectorId: job.connectorId,
        source: job.source,
        acquisitionMode: job.acquisitionMode,
        operation: job.operation,
        status: "completed",
        correlationId: job.correlationId,
        payloadHash: job.payloadHash,
        idempotencyKey: job.idempotencyKey,
        resultHash: input.resultHash,
        recordCount: 1,
        previousCursor: null,
        cursorCandidate: null,
        error: null,
        capture: {
          attemptId: attempt.id,
          nodeId: input.nodeId,
          profileId: input.profileId,
          canonicalUrl: input.canonicalUrl,
          invocationIdempotencyKey: input.invocationIdempotencyKey,
          contentHash: input.contentHash,
          acceptedRawListingId: rawImport.record.id,
          acceptedAt: input.acceptedAt
        },
        completedAt: input.acceptedAt,
        idempotentReplay: false,
        untrustedInput: true
      }
    });

    return { acceptance, rawListing: rawImport.record, replayed: false };
  });
}
