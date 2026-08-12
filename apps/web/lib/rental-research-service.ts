import { randomUUID } from "node:crypto";

import {
  createLoopbackBrowserResearchClient,
  createLoopbackZillowResearchClient,
  createMaritimeBrowserResearchClient,
  createMaritimeZillowResearchClient,
  getBrowserSourceAdapter,
  MaritimeBrowserResearchError,
  MaritimeZillowResearchError,
  zillowObservedListingToEnvelope,
  zillowResearchSafeCaptureMetadata,
  ZILLOW_BROWSER_RESEARCH_CONNECTOR_ID
} from "@vera/connectors";
import {
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  RawListingCaptureSchema,
  RentalResearchRunStatusSchema,
  RunRentalResearchRequestSchema,
  SourceJobSchema,
  ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE,
  type ActivityEvent,
  type BrowserResearchManualAction,
  type BrowserResearchOutput,
  type BrowserResearchPlan,
  type BrowserResearchSource,
  type SelectedHousingSourceConfiguration,
  type RentalResearchProgressPhase,
  type RentalResearchRunStatus,
  type RentalResearchSource,
  type RentalResearchSourceStatus,
  type SearchProfile,
  type SourceJob,
  type VeraUserId,
  type ZillowRentalResearchInput,
  type ZillowRentalResearchOutput,
  type ZillowResearchManualAction
} from "@vera/domain";

import { runLiveSearch, type LiveSearchServiceDependencies } from "./live-search-service.ts";
import {
  parseZillowResearchCheckpointEnvironment,
  type ZillowResearchCheckpointEnvironment
} from "./zillow-research-checkpoint-service.ts";

export const RENTAL_RESEARCH_ACTIONS = {
  requested: "rental_research_run_requested",
  sourceStarted: "zillow_research_started",
  sourceFinished: "zillow_research_finished",
  sourceFailed: "zillow_research_failed",
  browserSourceStarted: "browser_research_source_started",
  browserSourceFinished: "browser_research_source_finished",
  browserSourceFailed: "browser_research_source_failed",
  sourcesFinished: "rental_research_sources_finished",
  stopped: "rental_research_stopped"
} as const;

const ZILLOW_OPERATION = "zillow.rental_research.v1";
const DISCOVERY_DETAIL_PAGES = 0;
const ZILLOW_MAX_RESULTS = 5;

export class RentalResearchServiceError extends Error {
  constructor(
    readonly code:
      | "profile_not_found"
      | "duplicate_run"
      | "zillow_disabled"
      | "zillow_profile_incomplete"
      | "run_not_found",
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(`Rental research stopped safely: ${code}.`);
    this.name = "RentalResearchServiceError";
  }
}

export interface RentalResearchDependencies {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly liveSearch: LiveSearchServiceDependencies;
  readonly zillow: {
    run(
      input: ZillowRentalResearchInput,
      options: { readonly signal: AbortSignal }
    ): Promise<ZillowRentalResearchOutput>;
  };
  readonly zillowEnvironment: ZillowResearchCheckpointEnvironment;
  readonly browserResearch: {
    run(
      plan: BrowserResearchPlan,
      options: { readonly signal: AbortSignal }
    ): Promise<BrowserResearchOutput>;
  };
  readonly browserResearchEnvironment: {
    readonly founderUserId: VeraUserId | null;
    readonly browserDisabled: boolean;
    readonly planSigningKey: string;
    readonly enabledSources: ReadonlySet<BrowserResearchSource>;
  };
  now(): Date;
  createId(): string;
}

function nowIso(dependencies: RentalResearchDependencies): string {
  const value = dependencies.now();
  if (Number.isNaN(value.getTime())) throw new Error("Rental-research clock is invalid.");
  return value.toISOString();
}

function hash(value: unknown): string {
  return sha256Text(canonicalJson(value as never));
}

function event(
  dependencies: RentalResearchDependencies,
  input: {
    action: string;
    runId: string;
    actor: ActivityEvent["actor"];
    outcome: ActivityEvent["outcome"];
    payloadHash: string;
    metadata: ActivityEvent["metadata"];
    occurredAt: string;
    causationId?: string | null;
    errorCategory?: ActivityEvent["errorCategory"];
    targetType?: string;
    targetId?: string;
    approvalId?: string | null;
  }
): ActivityEvent {
  return ActivityEventSchema.parse({
    id: dependencies.createId(),
    correlationId: input.runId,
    causationId: input.causationId ?? null,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType ?? "live_search_run",
    targetId: input.targetId ?? input.runId,
    policyDecision: "authorized",
    approvalId: input.approvalId ?? null,
    payloadHash: input.payloadHash,
    outcome: input.outcome,
    errorCategory: input.errorCategory ?? null,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
}

function explicitPropertyType(
  profile: SearchProfile
): "apartment" | "house" | "townhouse" | "condo" | undefined {
  const constraint = profile.hardConstraints.find(
    (candidate) =>
      candidate.field.trim().toLowerCase() === "propertytype" &&
      candidate.operator === "equals" &&
      typeof candidate.value === "string"
  );
  const value = typeof constraint?.value === "string" ? constraint.value.trim().toLowerCase() : "";
  return ["apartment", "house", "townhouse", "condo"].includes(value)
    ? (value as "apartment" | "house" | "townhouse" | "condo")
    : undefined;
}

function zillowInput(profile: SearchProfile, jobId: string) {
  const maximumCents = profile.absoluteMonthlyMaximumCents ?? profile.targetMonthlyTotalCents;
  if (maximumCents === null || maximumCents < 100) {
    throw new RentalResearchServiceError("zillow_profile_incomplete", 422, false);
  }
  const propertyType = explicitPropertyType(profile);
  return {
    version: "1" as const,
    veraRunId: jobId,
    profile: {
      location: profile.locationText,
      maximumRentUsd: Math.floor(maximumCents / 100),
      minimumBedrooms: profile.minimumBedrooms ?? 0,
      ...(profile.minimumBathrooms === null ? {} : { minimumBathrooms: profile.minimumBathrooms }),
      ...(propertyType === undefined ? {} : { rentalPropertyType: propertyType })
    },
    maxResults: ZILLOW_MAX_RESULTS,
    maxDetailPages: DISCOVERY_DETAIL_PAGES,
    startingTabReference: {
      kind: "single_shared_tab" as const,
      value: ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE
    }
  };
}

function zillowJob(
  dependencies: RentalResearchDependencies,
  profile: SearchProfile,
  parentRunId: string,
  jobId: string,
  createdAt: string
): SourceJob {
  const input = zillowInput(profile, jobId);
  const payload = {
    acquisitionMode: "local_browser" as const,
    captureKind: "research_tab" as const,
    nodeId: "remote-extension-gateway",
    profileId: "official-chrome-extension",
    startingTabReference: input.startingTabReference,
    limits: {
      maxPages: 6,
      maxRecords: 10,
      maxBytes: 250_000,
      maxDurationMilliseconds: 90_000,
      maxConcurrency: 1 as const
    },
    maxDetailPages: DISCOVERY_DETAIL_PAGES,
    maxResultPageExpansions: 2 as const
  };
  const payloadHash = hash(payload);
  return SourceJobSchema.parse({
    id: jobId,
    correlationId: parentRunId,
    connectorId: ZILLOW_BROWSER_RESEARCH_CONNECTOR_ID,
    source: "zillow",
    acquisitionMode: "local_browser",
    manifestVersion: 1,
    trigger: "manual",
    capability: "browser.capture",
    approvalId: `approval:${jobId}`,
    operation: ZILLOW_OPERATION,
    payload,
    payloadHash,
    idempotencyKey: sha256Text(
      `zillow-research-job:v1:${dependencies.userId}:${profile.id}:${jobId}:${payloadHash}`
    ),
    status: "queued",
    attempts: 0,
    maxAttempts: 1,
    manualAction: null,
    deferredReason: null,
    result: null,
    createdAt,
    updatedAt: createdAt,
    completedAt: null
  });
}

function manualBlocker(
  action: ZillowResearchManualAction
): SourceJob["manualAction"] extends infer _Value
  ? | "login_required"
    | "two_factor_required"
    | "captcha_required"
    | "consent_required"
    | "rate_or_bot_challenge"
    | "layout_incompatible"
    | "node_offline"
    | "user_intervention_required"
  : never {
  if (action === "login_required") return "login_required";
  if (action === "two_factor_required") return "two_factor_required";
  if (action === "captcha_required") return "captcha_required";
  if (action === "consent_required") return "consent_required";
  if (action === "blocked") return "rate_or_bot_challenge";
  if (action === "layout_changed") return "layout_incompatible";
  if (action === "browser_offline") return "node_offline";
  return "user_intervention_required";
}

function manualInstruction(
  action: NonNullable<RentalResearchSourceStatus["manualAction"]>
): string {
  if (action === "tab_required")
    return "Open and explicitly share exactly one dedicated Vera Search tab.";
  if (action === "checkpoint_required")
    return "Complete the browser security checkpoint manually, then retry.";
  if (action === "no_shared_tab")
    return "Open Zillow rentals and explicitly share exactly one tab.";
  if (action === "multiple_shared_tabs") return "Unshare every tab except one Zillow rental tab.";
  if (action === "login_required") return "Log into Zillow manually in the shared tab, then retry.";
  if (action === "two_factor_required")
    return "Complete Zillow two-factor authentication manually, then retry.";
  if (action === "captcha_required") return "Complete the Zillow challenge manually, then retry.";
  if (action === "consent_required")
    return "Review the Zillow consent prompt manually, then retry.";
  if (action === "browser_offline") return "Reconnect the official OpenClaw extension, then retry.";
  if (action === "cancelled")
    return "The search was stopped. Start a new user-triggered run to continue.";
  return "Review the shared Zillow tab manually, then retry the failed source.";
}

async function importZillowListings(
  dependencies: RentalResearchDependencies,
  profile: SearchProfile,
  parentRunId: string,
  sourceJobId: string,
  listings: ZillowRentalResearchOutput["listings"]
): Promise<{ importedCount: number; rejectedCount: number }> {
  let importedCount = 0;
  let rejectedCount = 0;
  for (const listing of listings) {
    const sourceJob = await dependencies.repositories.sourceJobs.getById(sourceJobId);
    if (sourceJob?.status === "cancelled_by_policy") break;
    try {
      const envelope = zillowObservedListingToEnvelope(listing);
      const capture = RawListingCaptureSchema.parse({
        id: dependencies.createId(),
        source: envelope.source,
        acquisitionMode: envelope.acquisitionMode,
        sourceListingId: envelope.sourceListingId,
        sourceUrl: envelope.sourceUrl,
        captureMethod: envelope.captureMethod,
        observedAt: envelope.observedAt,
        sourcePostedAt: envelope.sourcePostedAt,
        rawText: envelope.rawText,
        rawJson: envelope.rawJson,
        captureMetadata: {
          ...envelope.captureMetadata,
          ...zillowResearchSafeCaptureMetadata(listing, {
            veraRunId: sourceJobId,
            searchProfileId: profile.id
          })
        }
      });
      const importEventId = dependencies.createId();
      const result = await dependencies.repositoryProvider.transaction(
        dependencies.userId,
        async (repositories) => {
          const imported = await repositories.rawListings.import(capture);
          const existingRecord = await repositories.sourceRecords.getByRawListingId(
            imported.record.id
          );
          const queued =
            existingRecord === null
              ? (
                  await repositories.normalizationJobs.enqueue({
                    id: dependencies.createId(),
                    rawListingId: imported.record.id,
                    idempotencyKey: sha256Text(`normalization-job:v1:${imported.record.id}`),
                    availableAt: nowIso(dependencies),
                    maxAttempts: 3,
                    correlationId: parentRunId,
                    causationId: importEventId,
                    createdAt: nowIso(dependencies)
                  })
                ).record
              : await repositories.normalizationJobs.getByRawListingId(imported.record.id);
          await repositories.activityEvents.append(
            ActivityEventSchema.parse({
              ...event(dependencies, {
                action: "live_listing_imported",
                runId: parentRunId,
                causationId: sourceJobId,
                actor: "connector",
                outcome: "succeeded",
                payloadHash: imported.record.contentHash,
                metadata: {
                  profileId: profile.id,
                  provider: "zillow",
                  sourceListingIdHash:
                    listing.sourceListingId === null ? null : sha256Text(listing.sourceListingId),
                  sourceUrlHash: sha256Text(envelope.sourceUrl ?? ""),
                  duplicate: !imported.inserted,
                  normalizationJobId: queued?.id ?? null,
                  missingFieldCount: listing.missingFields.length,
                  warningCount: listing.safeExtractionWarnings.length
                },
                occurredAt: nowIso(dependencies),
                targetType: "raw_listing",
                targetId: imported.record.id
              }),
              id: importEventId
            })
          );
          return imported.inserted;
        }
      );
      if (result) importedCount += 1;
    } catch {
      rejectedCount += 1;
      await dependencies.repositories.activityEvents.append(
        event(dependencies, {
          action: "live_listing_rejected",
          runId: parentRunId,
          causationId: sourceJobId,
          actor: "system",
          outcome: "failed",
          errorCategory: "validation",
          payloadHash: hash({
            sourceListingId: listing.sourceListingId,
            observedAt: listing.observedAt
          }),
          metadata: { profileId: profile.id, provider: "zillow" },
          occurredAt: nowIso(dependencies)
        })
      );
    }
  }
  return { importedCount, rejectedCount };
}

async function runZillowSource(
  dependencies: RentalResearchDependencies,
  profile: SearchProfile,
  parentRunId: string,
  isOnlySource: boolean
): Promise<void> {
  if (
    !dependencies.zillowEnvironment.sourceEnabled ||
    dependencies.zillowEnvironment.browserDisabled ||
    dependencies.zillowEnvironment.founderUserId !== dependencies.userId
  ) {
    throw new RentalResearchServiceError("zillow_disabled", 503, false);
  }
  const jobId = isOnlySource ? parentRunId : `${parentRunId}.zillow`;
  const createdAt = nowIso(dependencies);
  const job = zillowJob(dependencies, profile, parentRunId, jobId, createdAt);
  const input = zillowInput(profile, jobId);
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    await repositories.approvals.insert({
      id: job.approvalId!,
      actor: "user",
      connectorId: job.connectorId,
      operation: job.operation,
      targetType: "source_job",
      targetId: job.id,
      payloadHash: job.payloadHash,
      state: "used",
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 120_000).toISOString(),
      usedAt: createdAt
    });
    const queued = await repositories.sourceJobs.enqueue(job);
    if (!queued.inserted) throw new RentalResearchServiceError("duplicate_run", 409, false);
    if (isOnlySource) {
      await repositories.activityEvents.append(
        event(dependencies, {
          action: "live_search_requested",
          runId: parentRunId,
          actor: "user",
          outcome: "recorded",
          payloadHash: job.payloadHash,
          metadata: { profileId: profile.id, provider: "zillow" },
          occurredAt: createdAt
        })
      );
    }
    await repositories.activityEvents.append(
      event(dependencies, {
        action: RENTAL_RESEARCH_ACTIONS.sourceStarted,
        runId: parentRunId,
        actor: "connector",
        outcome: "authorized",
        payloadHash: job.payloadHash,
        metadata: {
          profileId: profile.id,
          source: "zillow",
          maxResults: ZILLOW_MAX_RESULTS,
          maxDetailPages: DISCOVERY_DETAIL_PAGES
        },
        occurredAt: createdAt,
        targetType: "source_job",
        targetId: jobId,
        approvalId: job.approvalId
      })
    );
    await repositories.sourceJobs.transition(jobId, "dispatched", createdAt);
    await repositories.sourceJobs.transition(jobId, "running", createdAt, { attempts: 1 });
  });

  try {
    const output = await dependencies.zillow.run(input, { signal: new AbortController().signal });
    const afterResearch = await dependencies.repositories.sourceJobs.getById(jobId);
    if (afterResearch?.status === "cancelled_by_policy") {
      await dependencies.repositories.activityEvents.append(
        event(dependencies, {
          action: RENTAL_RESEARCH_ACTIONS.sourceFinished,
          runId: parentRunId,
          causationId: jobId,
          actor: "connector",
          outcome: "succeeded",
          payloadHash: hash({ state: "cancelled" }),
          metadata: {
            profileId: profile.id,
            source: "zillow",
            outputState: "manual_action_required",
            pageState: output.pageState,
            manualAction: "cancelled",
            retrievedCount: 0,
            importedCount: 0,
            rejectedCount: 0,
            resultCardsObserved: 0,
            detailPagesOpened: 0,
            resultPageExpansions: 0,
            warningCount: 0
          },
          occurredAt: nowIso(dependencies),
          targetType: "source_job",
          targetId: jobId,
          approvalId: job.approvalId
        })
      );
      return;
    }
    const imported = await importZillowListings(
      dependencies,
      profile,
      parentRunId,
      jobId,
      output.listings
    );
    const finishedAt = nowIso(dependencies);
    if (output.state === "manual_action_required" && output.manualAction !== null) {
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        "manual_action_required",
        finishedAt,
        {
          attempts: 1,
          manualAction: {
            jobId,
            nodeId: "remote-extension-gateway",
            source: "zillow",
            blocker: manualBlocker(output.manualAction),
            instruction: manualInstruction(output.manualAction),
            correlationId: parentRunId,
            requiredAt: finishedAt
          }
        }
      );
    } else if (output.state === "failed" && output.listings.length === 0) {
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        "permanently_failed",
        finishedAt,
        {
          attempts: 1,
          result: {
            jobId,
            connectorId: job.connectorId,
            source: "zillow",
            acquisitionMode: "local_browser",
            operation: ZILLOW_OPERATION,
            status: "failed",
            correlationId: parentRunId,
            payloadHash: job.payloadHash,
            idempotencyKey: job.idempotencyKey,
            resultHash: hash({ state: output.state, completedAt: output.completedAt }),
            recordCount: 0,
            previousCursor: null,
            cursorCandidate: null,
            error: { code: "zillow_research_failed", category: "permanent_provider" },
            capture: null,
            completedAt: finishedAt,
            idempotentReplay: false,
            untrustedInput: true
          }
        }
      );
    } else {
      await dependencies.repositories.sourceJobs.transition(jobId, "completed", finishedAt, {
        attempts: 1,
        result: {
          jobId,
          connectorId: job.connectorId,
          source: "zillow",
          acquisitionMode: "local_browser",
          operation: ZILLOW_OPERATION,
          status: "completed",
          correlationId: parentRunId,
          payloadHash: job.payloadHash,
          idempotencyKey: job.idempotencyKey,
          resultHash: hash({
            outputState: output.state,
            listingCount: output.listings.length,
            importedCount: imported.importedCount
          }),
          recordCount: imported.importedCount,
          previousCursor: null,
          cursorCandidate: null,
          error: null,
          capture: null,
          completedAt: finishedAt,
          idempotentReplay: false,
          untrustedInput: true
        }
      });
    }
    await dependencies.repositories.activityEvents.append(
      event(dependencies, {
        action: RENTAL_RESEARCH_ACTIONS.sourceFinished,
        runId: parentRunId,
        causationId: jobId,
        actor: "connector",
        outcome: "succeeded",
        payloadHash: hash({
          state: output.state,
          pageState: output.pageState,
          importedCount: imported.importedCount
        }),
        metadata: {
          profileId: profile.id,
          source: "zillow",
          outputState: output.state,
          pageState: output.pageState,
          manualAction: output.manualAction,
          retrievedCount: output.listings.length,
          importedCount: imported.importedCount,
          rejectedCount: imported.rejectedCount,
          resultCardsObserved: output.resultCardsObserved,
          detailPagesOpened: output.detailPagesOpened,
          resultPageExpansions: output.resultPageExpansions,
          warningCount: output.warnings.length,
          warnings: output.warnings
        },
        occurredAt: finishedAt,
        targetType: "source_job",
        targetId: jobId,
        approvalId: job.approvalId
      })
    );
  } catch (error: unknown) {
    const failedAt = nowIso(dependencies);
    const current = await dependencies.repositories.sourceJobs.getById(jobId);
    if (current?.status === "running") {
      const retryable = error instanceof MaritimeZillowResearchError && error.retryable;
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        retryable ? "retryable_failed" : "permanently_failed",
        failedAt,
        {
          attempts: 1,
          result: {
            jobId,
            connectorId: job.connectorId,
            source: "zillow",
            acquisitionMode: "local_browser",
            operation: ZILLOW_OPERATION,
            status: "failed",
            correlationId: parentRunId,
            payloadHash: job.payloadHash,
            idempotencyKey: job.idempotencyKey,
            resultHash: hash({ code: "zillow_research_unavailable", failedAt }),
            recordCount: 0,
            previousCursor: null,
            cursorCandidate: null,
            error: {
              code:
                error instanceof MaritimeZillowResearchError
                  ? error.code
                  : "zillow_research_unavailable",
              category: retryable ? "transient_provider" : "permanent_provider"
            },
            capture: null,
            completedAt: failedAt,
            idempotentReplay: false,
            untrustedInput: true
          }
        }
      );
    }
    await dependencies.repositories.activityEvents.append(
      event(dependencies, {
        action: RENTAL_RESEARCH_ACTIONS.sourceFailed,
        runId: parentRunId,
        causationId: jobId,
        actor: "connector",
        outcome: "failed",
        errorCategory:
          error instanceof MaritimeZillowResearchError && error.retryable
            ? "transient_provider"
            : "permanent_provider",
        payloadHash: job.payloadHash,
        metadata: {
          profileId: profile.id,
          source: "zillow",
          retryable: error instanceof MaritimeZillowResearchError && error.retryable
        },
        occurredAt: failedAt,
        targetType: "source_job",
        targetId: jobId,
        approvalId: job.approvalId
      })
    );
  }
}

type AdditionalBrowserResearchSource = Exclude<BrowserResearchSource, "zillow">;

function browserResearchJob(
  dependencies: RentalResearchDependencies,
  profile: SearchProfile,
  parentRunId: string,
  source: AdditionalBrowserResearchSource,
  configuration: SelectedHousingSourceConfiguration | undefined,
  jobId: string,
  createdAt: string
): { readonly job: SourceJob; readonly plan: BrowserResearchPlan } {
  const adapter = getBrowserSourceAdapter(source, configuration);
  const plan = adapter.createPlan({
    veraRunId: jobId,
    profile,
    startingTabReference: {
      kind: "single_shared_tab",
      value: ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE
    },
    signingKey: dependencies.browserResearchEnvironment.planSigningKey,
    issuedAt: new Date(createdAt),
    maxResults: 10,
    maxDetailPages: configuration?.captureCurrentPage ? 1 : DISCOVERY_DETAIL_PAGES,
    ...(configuration?.captureCurrentPage ? { mode: "current_page" as const } : {})
  });
  const payload = {
    acquisitionMode: "local_browser" as const,
    captureKind: "research_tab" as const,
    nodeId: "remote-extension-gateway",
    profileId: "official-chrome-extension",
    startingTabReference: plan.startingTabReference,
    limits: {
      maxPages: 6,
      maxRecords: 10,
      maxBytes: 250_000,
      maxDurationMilliseconds: 90_000,
      maxConcurrency: 1 as const
    },
    maxDetailPages: configuration?.captureCurrentPage ? 1 : DISCOVERY_DETAIL_PAGES,
    maxResultPageExpansions: 2 as const
  };
  const payloadHash = hash(payload);
  return {
    plan,
    job: SourceJobSchema.parse({
      id: jobId,
      correlationId: parentRunId,
      connectorId: adapter.connectorId,
      source,
      acquisitionMode: "local_browser",
      manifestVersion: 1,
      trigger: "manual",
      capability: "browser.capture",
      approvalId: `approval:${jobId}`,
      operation: adapter.operation,
      payload,
      payloadHash,
      idempotencyKey: sha256Text(
        `browser-research-job:v1:${dependencies.userId}:${profile.id}:${source}:${jobId}:${payloadHash}`
      ),
      status: "queued",
      attempts: 0,
      maxAttempts: 1,
      manualAction: null,
      deferredReason: null,
      result: null,
      createdAt,
      updatedAt: createdAt,
      completedAt: null
    })
  };
}

function browserManualBlocker(
  action: BrowserResearchManualAction
): SourceJob["manualAction"] extends infer _Value
  ? | "login_required"
    | "two_factor_required"
    | "captcha_required"
    | "consent_required"
    | "rate_or_bot_challenge"
    | "layout_incompatible"
    | "node_offline"
    | "user_intervention_required"
  : never {
  if (action === "login_required") return "login_required";
  if (action === "two_factor_required" || action === "checkpoint_required") {
    return "two_factor_required";
  }
  if (action === "captcha_required") return "captcha_required";
  if (action === "consent_required") return "consent_required";
  if (action === "blocked") return "rate_or_bot_challenge";
  if (action === "layout_changed") return "layout_incompatible";
  if (action === "browser_offline") return "node_offline";
  return "user_intervention_required";
}

function browserManualInstruction(
  source: AdditionalBrowserResearchSource,
  action: BrowserResearchManualAction
): string {
  const label = sourceLabelsForMessage(source);
  if (action === "tab_required") return "Open and explicitly share one dedicated Vera Search tab.";
  if (action === "multiple_shared_tabs")
    return "Unshare every tab except the dedicated Vera Search tab.";
  if (action === "login_required") return `Sign into ${label} manually, then continue the search.`;
  if (action === "two_factor_required" || action === "checkpoint_required") {
    return `Complete the ${label} security checkpoint manually, then continue the search.`;
  }
  if (action === "captcha_required")
    return `Complete the ${label} CAPTCHA manually, then continue the search.`;
  if (action === "consent_required")
    return `Review the ${label} consent prompt manually, then continue the search.`;
  if (action === "browser_offline") return "Reconnect the official OpenClaw extension, then retry.";
  if (action === "cancelled")
    return "The search was stopped. Start a new user-triggered run to continue.";
  return `Review the ${label} tab manually, then retry only this source.`;
}

async function importBrowserListings(
  dependencies: RentalResearchDependencies,
  profile: SearchProfile,
  parentRunId: string,
  sourceJobId: string,
  source: AdditionalBrowserResearchSource,
  configuration: SelectedHousingSourceConfiguration | undefined,
  listings: BrowserResearchOutput["listings"]
): Promise<{ importedCount: number; rejectedCount: number }> {
  const adapter = getBrowserSourceAdapter(source, configuration);
  let importedCount = 0;
  let rejectedCount = 0;
  for (const listing of listings) {
    const sourceJob = await dependencies.repositories.sourceJobs.getById(sourceJobId);
    if (sourceJob?.status === "cancelled_by_policy") break;
    try {
      const envelope = adapter.toEnvelope(listing);
      const capture = RawListingCaptureSchema.parse({
        id: dependencies.createId(),
        source: envelope.source,
        acquisitionMode: envelope.acquisitionMode,
        sourceListingId: envelope.sourceListingId,
        sourceUrl: envelope.sourceUrl,
        captureMethod: envelope.captureMethod,
        observedAt: envelope.observedAt,
        sourcePostedAt: envelope.sourcePostedAt,
        rawText: envelope.rawText,
        rawJson: envelope.rawJson,
        captureMetadata: {
          ...envelope.captureMetadata,
          ...adapter.safeCaptureMetadata(listing, {
            veraRunId: sourceJobId,
            searchProfileId: profile.id
          })
        }
      });
      const importEventId = dependencies.createId();
      const inserted = await dependencies.repositoryProvider.transaction(
        dependencies.userId,
        async (repositories) => {
          const imported = await repositories.rawListings.import(capture);
          const existingRecord = await repositories.sourceRecords.getByRawListingId(
            imported.record.id
          );
          const queued =
            existingRecord === null
              ? (
                  await repositories.normalizationJobs.enqueue({
                    id: dependencies.createId(),
                    rawListingId: imported.record.id,
                    idempotencyKey: sha256Text(`normalization-job:v1:${imported.record.id}`),
                    availableAt: nowIso(dependencies),
                    maxAttempts: 3,
                    correlationId: parentRunId,
                    causationId: importEventId,
                    createdAt: nowIso(dependencies)
                  })
                ).record
              : await repositories.normalizationJobs.getByRawListingId(imported.record.id);
          await repositories.activityEvents.append(
            ActivityEventSchema.parse({
              ...event(dependencies, {
                action: "live_listing_imported",
                runId: parentRunId,
                causationId: sourceJobId,
                actor: "connector",
                outcome: "succeeded",
                payloadHash: imported.record.contentHash,
                metadata: {
                  profileId: profile.id,
                  provider: source,
                  sourceListingIdHash:
                    listing.sourceListingId === null ? null : sha256Text(listing.sourceListingId),
                  sourceUrlHash: sha256Text(envelope.sourceUrl ?? ""),
                  duplicate: !imported.inserted,
                  normalizationJobId: queued?.id ?? null,
                  missingFieldCount: listing.missingFields.length,
                  warningCount: listing.safeExtractionWarnings.length
                },
                occurredAt: nowIso(dependencies),
                targetType: "raw_listing",
                targetId: imported.record.id
              }),
              id: importEventId
            })
          );
          return imported.inserted;
        }
      );
      if (inserted) importedCount += 1;
    } catch {
      rejectedCount += 1;
      await dependencies.repositories.activityEvents.append(
        event(dependencies, {
          action: "live_listing_rejected",
          runId: parentRunId,
          causationId: sourceJobId,
          actor: "system",
          outcome: "failed",
          errorCategory: "validation",
          payloadHash: hash({
            source,
            sourceListingId: listing.sourceListingId,
            observedAt: listing.observedAt
          }),
          metadata: { profileId: profile.id, provider: source },
          occurredAt: nowIso(dependencies)
        })
      );
    }
  }
  return { importedCount, rejectedCount };
}

async function runAdditionalBrowserSource(
  dependencies: RentalResearchDependencies,
  profile: SearchProfile,
  parentRunId: string,
  source: AdditionalBrowserResearchSource,
  configuration: SelectedHousingSourceConfiguration | undefined
): Promise<void> {
  const environment = dependencies.browserResearchEnvironment;
  if (
    environment.browserDisabled ||
    environment.founderUserId !== dependencies.userId ||
    !environment.enabledSources.has(source)
  ) {
    throw new RentalResearchServiceError("zillow_disabled", 503, false);
  }
  const jobId = `${parentRunId}.${source}`;
  const createdAt = nowIso(dependencies);
  const { job, plan } = browserResearchJob(
    dependencies,
    profile,
    parentRunId,
    source,
    configuration,
    jobId,
    createdAt
  );
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    await repositories.approvals.insert({
      id: job.approvalId!,
      actor: "user",
      connectorId: job.connectorId,
      operation: job.operation,
      targetType: "source_job",
      targetId: job.id,
      payloadHash: job.payloadHash,
      state: "used",
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + 120_000).toISOString(),
      usedAt: createdAt
    });
    const queued = await repositories.sourceJobs.enqueue(job);
    if (!queued.inserted) throw new RentalResearchServiceError("duplicate_run", 409, false);
    await repositories.activityEvents.append(
      event(dependencies, {
        action: RENTAL_RESEARCH_ACTIONS.browserSourceStarted,
        runId: parentRunId,
        actor: "connector",
        outcome: "authorized",
        payloadHash: job.payloadHash,
        metadata: {
          profileId: profile.id,
          source,
          maxResults: plan.maxResults,
          maxDetailPages: plan.maxDetailPages,
          maxActions: plan.maxActions
        },
        occurredAt: createdAt,
        targetType: "source_job",
        targetId: jobId,
        approvalId: job.approvalId
      })
    );
    await repositories.sourceJobs.transition(jobId, "dispatched", createdAt);
    await repositories.sourceJobs.transition(jobId, "running", createdAt, { attempts: 1 });
  });

  try {
    const output = await dependencies.browserResearch.run(plan, {
      signal: new AbortController().signal
    });
    const current = await dependencies.repositories.sourceJobs.getById(jobId);
    if (current?.status === "cancelled_by_policy") return;
    const imported = await importBrowserListings(
      dependencies,
      profile,
      parentRunId,
      jobId,
      source,
      configuration,
      output.listings
    );
    const finishedAt = nowIso(dependencies);
    if (output.state === "manual_action_required" && output.manualAction !== null) {
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        "manual_action_required",
        finishedAt,
        {
          attempts: 1,
          manualAction: {
            jobId,
            nodeId: "remote-extension-gateway",
            source,
            blocker: browserManualBlocker(output.manualAction),
            instruction: browserManualInstruction(source, output.manualAction),
            correlationId: parentRunId,
            requiredAt: finishedAt
          }
        }
      );
    } else if (output.state === "failed" && output.listings.length === 0) {
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        "permanently_failed",
        finishedAt,
        {
          attempts: 1,
          result: {
            jobId,
            connectorId: job.connectorId,
            source,
            acquisitionMode: "local_browser",
            operation: job.operation,
            status: "failed",
            correlationId: parentRunId,
            payloadHash: job.payloadHash,
            idempotencyKey: job.idempotencyKey,
            resultHash: hash({ source, state: output.state, completedAt: output.completedAt }),
            recordCount: 0,
            previousCursor: null,
            cursorCandidate: null,
            error: { code: "browser_research_failed", category: "permanent_provider" },
            capture: null,
            completedAt: finishedAt,
            idempotentReplay: false,
            untrustedInput: true
          }
        }
      );
    } else {
      await dependencies.repositories.sourceJobs.transition(jobId, "completed", finishedAt, {
        attempts: 1,
        result: {
          jobId,
          connectorId: job.connectorId,
          source,
          acquisitionMode: "local_browser",
          operation: job.operation,
          status: "completed",
          correlationId: parentRunId,
          payloadHash: job.payloadHash,
          idempotencyKey: job.idempotencyKey,
          resultHash: hash({
            source,
            outputState: output.state,
            listingCount: output.listings.length,
            importedCount: imported.importedCount
          }),
          recordCount: imported.importedCount,
          previousCursor: null,
          cursorCandidate: null,
          error: null,
          capture: null,
          completedAt: finishedAt,
          idempotentReplay: false,
          untrustedInput: true
        }
      });
    }
    await dependencies.repositories.activityEvents.append(
      event(dependencies, {
        action: RENTAL_RESEARCH_ACTIONS.browserSourceFinished,
        runId: parentRunId,
        causationId: jobId,
        actor: "connector",
        outcome: "succeeded",
        payloadHash: hash({ source, state: output.state, importedCount: imported.importedCount }),
        metadata: {
          profileId: profile.id,
          source,
          outputState: output.state,
          pageState: output.pageState,
          manualAction: output.manualAction,
          retrievedCount: output.listings.length,
          importedCount: imported.importedCount,
          rejectedCount: imported.rejectedCount,
          resultCardsObserved: output.resultCardsObserved,
          detailPagesOpened: output.detailPagesOpened,
          actionCount: output.actionsUsed,
          warningCount: output.warnings.length,
          warnings: output.warnings
        },
        occurredAt: finishedAt,
        targetType: "source_job",
        targetId: jobId,
        approvalId: job.approvalId
      })
    );
  } catch (error: unknown) {
    const failedAt = nowIso(dependencies);
    const current = await dependencies.repositories.sourceJobs.getById(jobId);
    const retryable = error instanceof MaritimeBrowserResearchError && error.retryable;
    if (current?.status === "running") {
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        retryable ? "retryable_failed" : "permanently_failed",
        failedAt,
        {
          attempts: 1,
          result: {
            jobId,
            connectorId: job.connectorId,
            source,
            acquisitionMode: "local_browser",
            operation: job.operation,
            status: "failed",
            correlationId: parentRunId,
            payloadHash: job.payloadHash,
            idempotencyKey: job.idempotencyKey,
            resultHash: hash({ source, code: "browser_research_unavailable", failedAt }),
            recordCount: 0,
            previousCursor: null,
            cursorCandidate: null,
            error: {
              code:
                error instanceof MaritimeBrowserResearchError
                  ? error.code
                  : "browser_research_unavailable",
              category: retryable ? "transient_provider" : "permanent_provider"
            },
            capture: null,
            completedAt: failedAt,
            idempotentReplay: false,
            untrustedInput: true
          }
        }
      );
    }
    await dependencies.repositories.activityEvents.append(
      event(dependencies, {
        action: RENTAL_RESEARCH_ACTIONS.browserSourceFailed,
        runId: parentRunId,
        causationId: jobId,
        actor: "connector",
        outcome: "failed",
        errorCategory: retryable ? "transient_provider" : "permanent_provider",
        payloadHash: job.payloadHash,
        metadata: { profileId: profile.id, source, retryable },
        occurredAt: failedAt,
        targetType: "source_job",
        targetId: jobId,
        approvalId: job.approvalId
      })
    );
  }
}

export async function runRentalResearch(
  rawRequest: unknown,
  dependencies: RentalResearchDependencies
): Promise<RentalResearchRunStatus> {
  const request = RunRentalResearchRequestSchema.parse(rawRequest);
  const profile = await dependencies.repositories.searchProfiles.getById(request.searchProfileId);
  if (!profile) throw new RentalResearchServiceError("profile_not_found", 404, false);
  if (await dependencies.repositories.sourceJobs.getById(request.veraRunId)) {
    throw new RentalResearchServiceError("duplicate_run", 409, false);
  }
  const requestedAt = nowIso(dependencies);
  await dependencies.repositories.activityEvents.append(
    event(dependencies, {
      action: RENTAL_RESEARCH_ACTIONS.requested,
      runId: request.veraRunId,
      actor: "user",
      outcome: "recorded",
      payloadHash: hash({
        profileId: profile.id,
        selectedSources: request.selectedSources,
        housingSourceConfigurationIds: request.housingSourceConfigurations.map(
          (configuration) => configuration.sourceId
        )
      }),
      metadata: {
        profileId: profile.id,
        selectedSources: request.selectedSources,
        housingSourceConfigurationIds: request.housingSourceConfigurations.map(
          (configuration) => configuration.sourceId
        ),
        retryOfSearchRunId: request.retryOfSearchRunId ?? null
      },
      occurredAt: requestedAt
    })
  );

  const operations: Array<{
    readonly source: RentalResearchSource;
    readonly promise: Promise<unknown>;
  }> = [];
  if (request.selectedSources.includes("rentcast")) {
    operations.push({
      source: "rentcast",
      promise: runLiveSearch(
        {
          searchProfileId: profile.id,
          confirmedExternalUsage: true,
          veraRunId: request.veraRunId,
          ...(request.retryOfSearchRunId ? { retryOfSearchRunId: request.retryOfSearchRunId } : {})
        },
        dependencies.liveSearch
      )
    });
  }
  let browserSequence = Promise.resolve();
  for (const source of request.selectedSources.filter(
    (candidate): candidate is Exclude<RentalResearchSource, "rentcast"> => candidate !== "rentcast"
  )) {
    const configuration = request.housingSourceConfigurations.find(
      (candidate) => candidate.source === source
    );
    const sourceRun = browserSequence.then(() =>
      source === "zillow"
        ? runZillowSource(
            dependencies,
            profile,
            request.veraRunId,
            request.selectedSources.length === 1
          )
        : runAdditionalBrowserSource(
            dependencies,
            profile,
            request.veraRunId,
            source,
            configuration
          )
    );
    operations.push({ source, promise: sourceRun });
    browserSequence = sourceRun.catch(() => undefined);
  }
  const outcomes = await Promise.allSettled(operations.map((operation) => operation.promise));
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status !== "rejected") continue;
    const source = operations[index]?.source;
    if (source === undefined) continue;
    const prior = (await dependencies.repositories.activityEvents.list()).some(
      (item) =>
        item.correlationId === request.veraRunId &&
        item.action ===
          (source === "rentcast"
            ? "live_search_failed"
            : source === "zillow"
              ? RENTAL_RESEARCH_ACTIONS.sourceFailed
              : RENTAL_RESEARCH_ACTIONS.browserSourceFailed)
    );
    if (!prior) {
      await dependencies.repositories.activityEvents.append(
        event(dependencies, {
          action:
            source === "rentcast"
              ? "live_search_failed"
              : source === "zillow"
                ? RENTAL_RESEARCH_ACTIONS.sourceFailed
                : RENTAL_RESEARCH_ACTIONS.browserSourceFailed,
          runId: request.veraRunId,
          actor: "system",
          outcome: "failed",
          errorCategory: "policy_denial",
          payloadHash: hash({ source, stoppedSafely: true }),
          metadata: {
            profileId: profile.id,
            source,
            provider: source,
            resultState:
              source === "rentcast"
                ? "provider_unavailable"
                : source === "zillow"
                  ? "zillow_disabled"
                  : "browser_research_disabled",
            retryable: false
          },
          occurredAt: nowIso(dependencies)
        })
      );
    }
  }
  await dependencies.repositories.activityEvents.append(
    event(dependencies, {
      action: RENTAL_RESEARCH_ACTIONS.sourcesFinished,
      runId: request.veraRunId,
      actor: "system",
      outcome: "succeeded",
      payloadHash: hash({ selectedSources: request.selectedSources }),
      metadata: { profileId: profile.id, selectedSources: request.selectedSources },
      occurredAt: nowIso(dependencies)
    })
  );
  return getRentalResearchStatus(request.veraRunId, dependencies);
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function selectedSourcesFromEvent(eventValue: ActivityEvent): RentalResearchSource[] {
  const parsed = RunRentalResearchRequestSchema.shape.selectedSources.safeParse(
    eventValue.metadata.selectedSources
  );
  return parsed.success ? parsed.data : [];
}

function zillowManualAction(job: SourceJob | null, finished: ActivityEvent | undefined) {
  const parsed = RentalResearchRunStatusSchema.shape.sources.element.shape.manualAction.safeParse(
    finished?.metadata.manualAction
  );
  if (parsed.success) return parsed.data;
  if (job?.status === "cancelled_by_policy") return "cancelled" as const;
  return null;
}

function firstSafeResearchWarning(finished: ActivityEvent | undefined): string | null {
  const warnings = finished?.metadata.warnings;
  if (!Array.isArray(warnings)) return null;
  const first = warnings.find(
    (warning): warning is string =>
      typeof warning === "string" && warning.trim().length > 0 && warning.length <= 240
  );
  return first?.trim() ?? null;
}

function sourceLabelsForMessage(source: RentalResearchSource): string {
  if (source === "apartments_com") return "Apartments.com";
  if (source === "facebook_marketplace") return "Facebook Marketplace";
  if (source === "bu_off_campus") return "BU Off-Campus Housing";
  if (source === "custom_website") return "Custom housing website";
  if (source === "craigslist") return "Craigslist";
  if (source === "zillow") return "Zillow";
  return "RentCast";
}

function sourceStatus(
  source: RentalResearchSource,
  selected: boolean,
  job: SourceJob | null,
  events: readonly ActivityEvent[]
): RentalResearchSourceStatus {
  if (!selected) {
    return {
      source,
      state: "excluded_by_user",
      retrievedCount: 0,
      importedCount: 0,
      rejectedCount: 0,
      manualAction: null,
      message: null
    };
  }
  const imports = events.filter(
    (item) => item.action === "live_listing_imported" && item.metadata.provider === source
  );
  const rejections = events.filter(
    (item) => item.action === "live_listing_rejected" && item.metadata.provider === source
  );
  const importIds = new Set(imports.map((item) => item.targetId));
  const terminalNormalizationFailures = events.filter(
    (item) =>
      item.action === "normalization.failed" &&
      item.metadata.retryable === false &&
      importIds.has(item.targetId)
  );
  if (source === "zillow") {
    const finished = events.findLast(
      (item) => item.action === RENTAL_RESEARCH_ACTIONS.sourceFinished
    );
    const manualAction = zillowManualAction(job, finished);
    const failed = events.findLast((item) => item.action === RENTAL_RESEARCH_ACTIONS.sourceFailed);
    const retrievedCount = numeric(finished?.metadata.retrievedCount);
    const importedCount = numeric(finished?.metadata.importedCount) || imports.length;
    const rejectedCount = numeric(finished?.metadata.rejectedCount) || rejections.length;
    const safeWarning = firstSafeResearchWarning(finished);
    let state: RentalResearchSourceStatus["state"] = "ready";
    if (job?.status === "manual_action_required") {
      if (manualAction === "login_required") state = "login_required";
      else if (manualAction === "browser_offline") state = "browser_offline";
      else if (
        manualAction === "tab_required" ||
        manualAction === "no_shared_tab" ||
        manualAction === "multiple_shared_tabs" ||
        manualAction === "shared_tab_changed"
      ) {
        state = "tab_required";
      } else {
        state = importedCount > 0 ? "partial" : "manual_action_required";
      }
    } else if (job?.status === "completed") {
      state =
        finished?.metadata.outputState === "no_results"
          ? "no_results"
          : finished?.metadata.outputState === "partial" || terminalNormalizationFailures.length > 0
            ? "partial"
            : "completed";
    } else if (
      job?.status === "retryable_failed" ||
      job?.status === "permanently_failed" ||
      job?.status === "cancelled_by_policy"
    ) {
      state = importedCount > 0 ? "partial" : "failed";
    } else if (failed) {
      state = importedCount > 0 ? "partial" : "failed";
    } else if (job !== null) {
      state = "searching";
    }
    return {
      source,
      state,
      retrievedCount,
      importedCount,
      rejectedCount,
      manualAction,
      message:
        manualAction !== null
          ? manualInstruction(manualAction)
          : terminalNormalizationFailures.length > 0
            ? `${terminalNormalizationFailures.length} imported Zillow record(s) could not be normalized; accepted results were preserved.`
            : safeWarning !== null
              ? safeWarning
              : failed
                ? "Zillow stopped safely; other source results were preserved."
                : null
    };
  }

  if (source !== "rentcast") {
    const finished = events.findLast(
      (item) =>
        item.action === RENTAL_RESEARCH_ACTIONS.browserSourceFinished &&
        item.metadata.source === source
    );
    const failed = events.findLast(
      (item) =>
        item.action === RENTAL_RESEARCH_ACTIONS.browserSourceFailed &&
        item.metadata.source === source
    );
    const manualAction = zillowManualAction(job, finished);
    const retrievedCount = numeric(finished?.metadata.retrievedCount);
    const importedCount = numeric(finished?.metadata.importedCount) || imports.length;
    const rejectedCount = numeric(finished?.metadata.rejectedCount) || rejections.length;
    const safeWarning = firstSafeResearchWarning(finished);
    let state: RentalResearchSourceStatus["state"] =
      source === "facebook_marketplace" ? "account_recommended" : "ready";
    if (job?.status === "manual_action_required") {
      if (manualAction === "login_required") state = "login_required";
      else if (manualAction === "browser_offline") state = "browser_offline";
      else if (
        manualAction === "tab_required" ||
        manualAction === "multiple_shared_tabs" ||
        manualAction === "shared_tab_changed"
      ) {
        state = "tab_required";
      } else {
        state = importedCount > 0 ? "partial" : "manual_action_required";
      }
    } else if (job?.status === "completed") {
      state =
        finished?.metadata.outputState === "no_results"
          ? "no_results"
          : finished?.metadata.outputState === "partial" || terminalNormalizationFailures.length > 0
            ? "partial"
            : "completed";
    } else if (
      job?.status === "retryable_failed" ||
      job?.status === "permanently_failed" ||
      job?.status === "cancelled_by_policy" ||
      failed
    ) {
      state = importedCount > 0 ? "partial" : "failed";
    } else if (job !== null) {
      state = "searching";
    }
    return {
      source,
      state,
      retrievedCount,
      importedCount,
      rejectedCount,
      manualAction,
      message:
        job?.manualAction?.instruction ??
        (terminalNormalizationFailures.length > 0
          ? `${terminalNormalizationFailures.length} imported ${sourceLabelsForMessage(source)} record(s) could not be normalized; accepted results were preserved.`
          : safeWarning !== null
            ? safeWarning
            : failed
              ? `${sourceLabelsForMessage(source)} stopped safely; other results were preserved.`
              : null)
    };
  }

  const provider = events.findLast((item) => item.action === "live_provider_query_completed");
  const failure = events.findLast(
    (item) => item.action === "live_search_failed" && item.metadata.provider === "rentcast"
  );
  let state: RentalResearchSourceStatus["state"] = "ready";
  if (failure) state = imports.length > 0 ? "partial" : "failed";
  else if (job?.status === "completed") {
    state = terminalNormalizationFailures.length > 0 ? "partial" : "completed";
  } else if (job !== null) state = "searching";
  return {
    source,
    state,
    retrievedCount: numeric(provider?.metadata.retrievedCount),
    importedCount: imports.length,
    rejectedCount: rejections.length,
    manualAction: job?.status === "cancelled_by_policy" ? "cancelled" : null,
    message:
      terminalNormalizationFailures.length > 0
        ? `${terminalNormalizationFailures.length} imported RentCast record(s) could not be normalized; accepted results were preserved.`
        : failure
          ? "RentCast stopped safely; other source results were preserved."
          : null
  };
}

function researchPhase(
  events: readonly ActivityEvent[],
  jobs: readonly SourceJob[],
  imports: readonly ActivityEvent[]
): RentalResearchProgressPhase {
  const sourcesFinished = events.some(
    (item) => item.action === RENTAL_RESEARCH_ACTIONS.sourcesFinished
  );
  const normalizedIds = new Set(
    events.filter((item) => item.action === "normalization.completed").map((item) => item.targetId)
  );
  const terminalNormalizationFailureIds = new Set(
    events
      .filter((item) => item.action === "normalization.failed" && item.metadata.retryable === false)
      .map((item) => item.targetId)
  );
  const allImportsNormalized =
    imports.length > 0 && imports.every((item) => normalizedIds.has(item.targetId));
  const allImportsTerminal =
    imports.length > 0 &&
    imports.every(
      (item) =>
        normalizedIds.has(item.targetId) || terminalNormalizationFailureIds.has(item.targetId)
    );
  if (
    sourcesFinished &&
    (imports.length === 0 ||
      (allImportsTerminal &&
        (terminalNormalizationFailureIds.size > 0 ||
          events.some((item) => item.action === "live_search_completed"))))
  ) {
    return "completed";
  }
  if (allImportsNormalized) return "scoring";
  if (normalizedIds.size > 0) return "deduplicating";
  if (imports.length > 0) return "importing";
  const running = jobs.find((job) => ["queued", "dispatched", "running"].includes(job.status));
  if (running?.source === "rentcast") return "searching_rentcast";
  if (running?.source === "zillow") return "searching_zillow";
  if (running?.source === "apartments_com") return "searching_apartments_com";
  if (running?.source === "facebook_marketplace") {
    return "searching_facebook_marketplace";
  }
  if (running?.source === "bu_off_campus") return "searching_bu_off_campus";
  if (running?.source === "custom_website") return "searching_custom_website";
  if (running?.source === "craigslist") return "searching_craigslist";
  if (jobs.length > 0) return "checking_sources";
  return "connecting_browser";
}

export async function getRentalResearchStatus(
  runId: string,
  dependencies: Pick<RentalResearchDependencies, "repositories">
): Promise<RentalResearchRunStatus> {
  const events = (await dependencies.repositories.activityEvents.list()).filter(
    (item) => item.correlationId === runId
  );
  const requested = events.find((item) => item.action === RENTAL_RESEARCH_ACTIONS.requested);
  if (!requested) throw new RentalResearchServiceError("run_not_found", 404, false);
  const selected = selectedSourcesFromEvent(requested);
  const profileId =
    typeof requested.metadata.profileId === "string" ? requested.metadata.profileId : "";
  const jobs = (await dependencies.repositories.sourceJobs.list()).filter(
    (job) => job.id === runId || job.correlationId === runId
  );
  const rentcast = jobs.find((job) => job.source === "rentcast") ?? null;
  const zillow = jobs.find((job) => job.source === "zillow") ?? null;
  const apartments = jobs.find((job) => job.source === "apartments_com") ?? null;
  const facebook = jobs.find((job) => job.source === "facebook_marketplace") ?? null;
  const buOffCampus = jobs.find((job) => job.source === "bu_off_campus") ?? null;
  const customWebsite = jobs.find((job) => job.source === "custom_website") ?? null;
  const craigslist = jobs.find((job) => job.source === "craigslist") ?? null;
  const imports = events.filter((item) => item.action === "live_listing_imported");
  const sources = [
    sourceStatus("rentcast", selected.includes("rentcast"), rentcast, events),
    sourceStatus("zillow", selected.includes("zillow"), zillow, events),
    sourceStatus("apartments_com", selected.includes("apartments_com"), apartments, events),
    sourceStatus(
      "facebook_marketplace",
      selected.includes("facebook_marketplace"),
      facebook,
      events
    ),
    sourceStatus("bu_off_campus", selected.includes("bu_off_campus"), buOffCampus, events),
    sourceStatus("custom_website", selected.includes("custom_website"), customWebsite, events),
    sourceStatus("craigslist", selected.includes("craigslist"), craigslist, events)
  ] as const;
  const phase = researchPhase(events, jobs, imports);
  const failures = sources.filter(
    (source) =>
      selected.includes(source.source) &&
      [
        "failed",
        "partial",
        "login_required",
        "browser_offline",
        "tab_required",
        "manual_action_required"
      ].includes(source.state)
  );
  return RentalResearchRunStatusSchema.parse({
    searchRunId: runId,
    searchProfileId: profileId,
    phase,
    sources,
    partial:
      failures.length > 0 &&
      sources.some(
        (source) =>
          selected.includes(source.source) &&
          (source.importedCount > 0 || source.state === "completed")
      ),
    completedAt:
      phase === "completed"
        ? (events.findLast(
            (item) =>
              item.action === "live_search_completed" ||
              item.action === RENTAL_RESEARCH_ACTIONS.sourcesFinished
          )?.occurredAt ?? null)
        : null
  });
}

export async function stopRentalResearch(
  runId: string,
  dependencies: RentalResearchDependencies
): Promise<RentalResearchRunStatus> {
  const jobs = (await dependencies.repositories.sourceJobs.list()).filter(
    (job) => job.id === runId || job.correlationId === runId
  );
  if (jobs.length === 0) throw new RentalResearchServiceError("run_not_found", 404, false);
  const stoppedAt = nowIso(dependencies);
  for (const job of jobs) {
    if (
      [
        "queued",
        "dispatched",
        "running",
        "retryable_failed",
        "deferred_node_offline",
        "manual_action_required"
      ].includes(job.status)
    ) {
      await dependencies.repositories.sourceJobs.transition(
        job.id,
        "cancelled_by_policy",
        stoppedAt,
        {
          manualAction: null,
          deferredReason: null
        }
      );
    }
  }
  await dependencies.repositories.activityEvents.append(
    event(dependencies, {
      action: RENTAL_RESEARCH_ACTIONS.stopped,
      runId,
      actor: "user",
      outcome: "succeeded",
      payloadHash: hash({ runId, stoppedAt }),
      metadata: { stoppedJobCount: jobs.length },
      occurredAt: stoppedAt
    })
  );
  return getRentalResearchStatus(runId, dependencies);
}

export function createRentalResearchDependencies(
  userId: VeraUserId,
  repositories: UserRepositories,
  repositoryProvider: UserRepositoryProvider,
  liveSearch: LiveSearchServiceDependencies,
  environment: NodeJS.ProcessEnv = process.env
): RentalResearchDependencies {
  const zillowEnvironment = parseZillowResearchCheckpointEnvironment(environment);
  const canConfigureZillow =
    (environment.MARITIME_BROWSER_GATEWAY_API_KEY?.trim().length ?? 0) >= 8 &&
    (environment.MARITIME_BROWSER_GATEWAY_AGENT_ID?.trim().length ?? 0) > 0;
  const signingKey = environment.VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY?.trim() ?? "";
  const localBridgeConfigured =
    (environment.VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_URL?.trim().length ?? 0) > 0 &&
    (environment.VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_TOKEN?.trim().length ?? 0) >= 32;
  const canConfigureBrowserResearch =
    (canConfigureZillow || localBridgeConfigured) && signingKey.length >= 32;
  const enabledSources = new Set<BrowserResearchSource>();
  if (environment.VERA_APARTMENTS_BROWSER_RESEARCH_ENABLED === "1") {
    enabledSources.add("apartments_com");
  }
  if (environment.VERA_FACEBOOK_MARKETPLACE_BROWSER_RESEARCH_ENABLED === "1") {
    enabledSources.add("facebook_marketplace");
  }
  if (environment.VERA_BU_OFF_CAMPUS_BROWSER_RESEARCH_ENABLED === "1") {
    enabledSources.add("bu_off_campus");
  }
  if (environment.VERA_GENERIC_HOUSING_BROWSER_RESEARCH_ENABLED === "1") {
    enabledSources.add("custom_website");
  }
  if (environment.VERA_CRAIGSLIST_BROWSER_RESEARCH_ENABLED === "1") {
    enabledSources.add("craigslist");
  }
  return {
    userId,
    repositories,
    repositoryProvider,
    liveSearch,
    zillow: localBridgeConfigured
      ? createLoopbackZillowResearchClient(environment)
      : canConfigureZillow
        ? createMaritimeZillowResearchClient(environment)
        : {
            async run() {
              throw new MaritimeZillowResearchError("gateway_unavailable", true);
            }
          },
    zillowEnvironment,
    browserResearch: canConfigureBrowserResearch
      ? localBridgeConfigured
        ? createLoopbackBrowserResearchClient(environment)
        : createMaritimeBrowserResearchClient(environment)
      : {
          async run() {
            throw new MaritimeBrowserResearchError("gateway_unavailable", true);
          }
        },
    browserResearchEnvironment: {
      founderUserId: zillowEnvironment.founderUserId,
      browserDisabled: zillowEnvironment.browserDisabled,
      planSigningKey: signingKey,
      enabledSources
    },
    now: () => new Date(),
    createId: randomUUID
  };
}
