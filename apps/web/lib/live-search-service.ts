import { randomUUID } from "node:crypto";

import {
  DEFAULT_LIVE_AGENT_PROMPT_VERSION,
  MaritimeOpenClawClient,
  MaritimeOpenClawError,
  RENTCAST_CONNECTOR_ID,
  RentCastConnector,
  RentCastConnectorError,
  buildRentCastRentalQuery,
  type MaritimeOpenClawAnalysisResult,
  type RentCastSearchResult
} from "@vera/connectors";
import {
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  LiveSearchAgentCriteriaSchema,
  LiveSearchStatusSchema,
  RawListingCaptureSchema,
  RunLiveSearchRequestSchema,
  SourceJobSchema,
  type ActivityEvent,
  type LiveSearchResultState,
  type LiveSearchStatus,
  type SearchProfile,
  type SourceJob,
  type VeraUserId
} from "@vera/domain";
import type { SourcePolicyRegistry } from "@vera/policy";

export const LIVE_SEARCH_ACTIONS = {
  requested: "live_search_requested",
  providerStarted: "live_provider_query_started",
  providerCompleted: "live_provider_query_completed",
  agentStarted: "maritime_agent_analysis_started",
  agentCompleted: "maritime_agent_analysis_completed",
  imported: "live_listing_imported",
  completed: "live_search_completed",
  failed: "live_search_failed"
} as const;

export class LiveSearchServiceError extends Error {
  constructor(
    readonly code:
      LiveSearchResultState | "forbidden" | "disabled" | "profile_not_found" | "duplicate_run",
    readonly status: number,
    readonly searchRunId: string | null,
    readonly retryable: boolean
  ) {
    super(`Live rental search stopped safely: ${code}.`);
    this.name = "LiveSearchServiceError";
  }
}

export interface LiveSearchServiceDependencies {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly rentCast: RentCastConnector;
  readonly maritime: MaritimeOpenClawClient;
  now(): Date;
  createId(): string;
}

export interface LiveSearchEnvironment {
  readonly enabled: boolean;
  readonly founderUserIds: ReadonlySet<string>;
}

function isoNow(dependencies: LiveSearchServiceDependencies): string {
  const now = dependencies.now();
  if (Number.isNaN(now.getTime())) throw new Error("Live-search clock is invalid.");
  return now.toISOString();
}

function safeHash(value: unknown): string {
  return sha256Text(canonicalJson(value as never));
}

function makeEvent(
  dependencies: LiveSearchServiceDependencies,
  input: {
    readonly action: string;
    readonly runId: string;
    readonly causationId: string | null;
    readonly actor: ActivityEvent["actor"];
    readonly outcome: ActivityEvent["outcome"];
    readonly errorCategory?: ActivityEvent["errorCategory"];
    readonly payloadHash: string;
    readonly metadata: ActivityEvent["metadata"];
    readonly occurredAt: string;
    readonly targetType?: string;
    readonly targetId?: string;
  }
): ActivityEvent {
  return ActivityEventSchema.parse({
    id: dependencies.createId(),
    correlationId: input.runId,
    causationId: input.causationId,
    actor: input.actor,
    action: input.action,
    targetType: input.targetType ?? "live_search_run",
    targetId: input.targetId ?? input.runId,
    policyDecision: "authorized",
    approvalId: null,
    payloadHash: input.payloadHash,
    outcome: input.outcome,
    errorCategory: input.errorCategory ?? null,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
}

function agentCriteria(profile: SearchProfile) {
  return LiveSearchAgentCriteriaSchema.parse({
    locationText: profile.locationText,
    minimumBedrooms: profile.minimumBedrooms,
    minimumBathrooms: profile.minimumBathrooms,
    targetMonthlyTotalCents: profile.targetMonthlyTotalCents,
    absoluteMonthlyMaximumCents: profile.absoluteMonthlyMaximumCents,
    moveInEarliest: profile.moveInEarliest,
    moveInLatest: profile.moveInLatest,
    requiredPets: profile.petRequirements
      .filter((requirement) => requirement.required)
      .map((requirement) => requirement.animal),
    preferences: profile.weightedPreferences.map((preference) => ({
      code: preference.code,
      weightBasisPoints: preference.weightBasisPoints,
      description: preference.description
    }))
  });
}

function mapFailure(error: unknown): {
  readonly state: LiveSearchResultState;
  readonly retryable: boolean;
  readonly category: ActivityEvent["errorCategory"];
} {
  if (error instanceof RentCastConnectorError) {
    if (error.code === "provider_auth_failed") {
      return { state: "provider_auth_failed", retryable: false, category: "authentication" };
    }
    if (error.code === "provider_rate_limited") {
      return { state: "provider_rate_limited", retryable: false, category: "rate_limit" };
    }
    return {
      state: "provider_unavailable",
      retryable: error.retryable,
      category: "transient_provider"
    };
  }
  if (error instanceof MaritimeOpenClawError) {
    return {
      state:
        error.code === "agent_timeout"
          ? "agent_timeout"
          : error.code === "agent_invalid_response"
            ? "agent_invalid_response"
            : "maritime_unavailable",
      retryable: error.retryable,
      category:
        error.code === "agent_invalid_response" ? "permanent_provider" : "transient_provider"
    };
  }
  return { state: "provider_unavailable", retryable: true, category: "internal" };
}

function sourceJob(
  dependencies: LiveSearchServiceDependencies,
  runId: string,
  profile: SearchProfile,
  runSequence: number,
  requestedAt: string
): SourceJob {
  const payload = {
    acquisitionMode: "official_api" as const,
    sourceConfigurationId: profile.id,
    committedCursor: null
  };
  const payloadHash = safeHash(payload);
  return SourceJobSchema.parse({
    id: runId,
    correlationId: runId,
    connectorId: RENTCAST_CONNECTOR_ID,
    source: "rentcast",
    acquisitionMode: "official_api",
    manifestVersion: 1,
    trigger: "manual",
    capability: "structured_feed.read",
    approvalId: null,
    operation: "rentcast.rental_listings.search",
    payload,
    payloadHash,
    idempotencyKey: sha256Text(
      `live-search-job:v1:${dependencies.userId}:${profile.id}:${String(runSequence)}:${payloadHash}`
    ),
    status: "queued",
    attempts: 0,
    maxAttempts: 2,
    manualAction: null,
    deferredReason: null,
    result: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
    completedAt: null
  });
}

function isConcurrent(job: SourceJob, profileId: string): boolean {
  return (
    job.connectorId === RENTCAST_CONNECTOR_ID &&
    job.payload.acquisitionMode === "official_api" &&
    job.payload.sourceConfigurationId === profileId &&
    ["queued", "dispatched", "running"].includes(job.status)
  );
}

function jobProfileId(job: SourceJob): string {
  if (
    job.payload.acquisitionMode !== "official_api" &&
    job.payload.acquisitionMode !== "email_alert"
  ) {
    throw new Error("Live-search source job lost its official-API profile binding.");
  }
  return job.payload.sourceConfigurationId;
}

async function failRun(
  dependencies: LiveSearchServiceDependencies,
  job: SourceJob,
  failure: ReturnType<typeof mapFailure>,
  causationId: string | null
): Promise<never> {
  const failedAt = isoNow(dependencies);
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    const current = await repositories.sourceJobs.getById(job.id);
    if (current && current.status === "running") {
      await repositories.sourceJobs.transition(
        job.id,
        failure.retryable ? "retryable_failed" : "permanently_failed",
        failedAt,
        {
          attempts: 1,
          result: {
            jobId: job.id,
            connectorId: job.connectorId,
            source: job.source,
            acquisitionMode: job.acquisitionMode,
            operation: job.operation,
            status: "failed",
            correlationId: job.correlationId,
            payloadHash: job.payloadHash,
            idempotencyKey: job.idempotencyKey,
            resultHash: safeHash({ state: failure.state, failedAt }),
            recordCount: 0,
            previousCursor: null,
            cursorCandidate: null,
            error: {
              code: failure.state,
              category: failure.category ?? "internal"
            },
            capture: null,
            completedAt: failedAt,
            idempotentReplay: false,
            untrustedInput: true
          }
        }
      );
    }
    await repositories.activityEvents.append(
      makeEvent(dependencies, {
        action: LIVE_SEARCH_ACTIONS.failed,
        runId: job.id,
        causationId,
        actor: "system",
        outcome: "failed",
        errorCategory: failure.category,
        payloadHash: job.payloadHash,
        metadata: {
          profileId: jobProfileId(job),
          provider: "rentcast",
          resultState: failure.state,
          retryable: failure.retryable
        },
        occurredAt: failedAt
      })
    );
  });
  throw new LiveSearchServiceError(
    failure.state,
    failure.retryable ? 503 : 422,
    job.id,
    failure.retryable
  );
}

async function completeNoResults(
  dependencies: LiveSearchServiceDependencies,
  job: SourceJob,
  provider: RentCastSearchResult,
  causationId: string
): Promise<never> {
  const completedAt = isoNow(dependencies);
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    await repositories.sourceJobs.transition(job.id, "completed", completedAt, {
      attempts: 1,
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
        resultHash: safeHash({ queryHash: provider.queryHash, count: 0 }),
        recordCount: 0,
        previousCursor: null,
        cursorCandidate: null,
        error: null,
        capture: null,
        completedAt,
        idempotentReplay: false,
        untrustedInput: true
      }
    });
    await repositories.activityEvents.append(
      makeEvent(dependencies, {
        action: LIVE_SEARCH_ACTIONS.failed,
        runId: job.id,
        causationId,
        actor: "system",
        outcome: "failed",
        errorCategory: "permanent_provider",
        payloadHash: job.payloadHash,
        metadata: {
          profileId: jobProfileId(job),
          provider: "rentcast",
          resultState: "no_matching_live_results",
          retryable: false
        },
        occurredAt: completedAt
      })
    );
  });
  throw new LiveSearchServiceError("no_matching_live_results", 404, job.id, false);
}

export async function runLiveSearch(
  requestInput: unknown,
  dependencies: LiveSearchServiceDependencies
): Promise<LiveSearchStatus> {
  const request = RunLiveSearchRequestSchema.parse(requestInput);
  const profile = await dependencies.repositories.searchProfiles.getById(request.searchProfileId);
  if (!profile) throw new LiveSearchServiceError("profile_not_found", 404, null, false);
  const existingJobs = await dependencies.repositories.sourceJobs.list();
  if (existingJobs.some((job) => isConcurrent(job, profile.id))) {
    throw new LiveSearchServiceError("duplicate_run", 409, null, false);
  }
  if (request.retryOfSearchRunId) {
    const prior = await dependencies.repositories.sourceJobs.getById(request.retryOfSearchRunId);
    if (!prior || prior.status !== "retryable_failed") {
      throw new LiveSearchServiceError("duplicate_run", 409, null, false);
    }
    const retries = (await dependencies.repositories.activityEvents.list()).filter(
      (event) =>
        event.action === LIVE_SEARCH_ACTIONS.requested &&
        event.metadata.retryOfSearchRunId === request.retryOfSearchRunId
    );
    if (retries.length > 0) throw new LiveSearchServiceError("duplicate_run", 409, null, false);
  }

  const runId = dependencies.createId();
  const requestedAt = isoNow(dependencies);
  const runSequence =
    existingJobs.filter(
      (existing) =>
        existing.connectorId === RENTCAST_CONNECTOR_ID &&
        existing.payload.acquisitionMode === "official_api" &&
        existing.payload.sourceConfigurationId === profile.id
    ).length + 1;
  const job = sourceJob(dependencies, runId, profile, runSequence, requestedAt);
  const requestedEvent = makeEvent(dependencies, {
    action: LIVE_SEARCH_ACTIONS.requested,
    runId,
    causationId: null,
    actor: "user",
    outcome: "recorded",
    payloadHash: job.payloadHash,
    metadata: {
      profileId: profile.id,
      provider: "rentcast",
      retryOfSearchRunId: request.retryOfSearchRunId ?? null
    },
    occurredAt: requestedAt
  });
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    const enqueued = await repositories.sourceJobs.enqueue(job);
    if (!enqueued.inserted) throw new LiveSearchServiceError("duplicate_run", 409, null, false);
    await repositories.activityEvents.append(requestedEvent);
    await repositories.sourceJobs.transition(runId, "dispatched", requestedAt);
    await repositories.sourceJobs.transition(runId, "running", requestedAt, { attempts: 1 });
  });

  let provider: RentCastSearchResult;
  let providerEventId = requestedEvent.id;
  try {
    const providerStartedAt = isoNow(dependencies);
    const providerStarted = makeEvent(dependencies, {
      action: LIVE_SEARCH_ACTIONS.providerStarted,
      runId,
      causationId: requestedEvent.id,
      actor: "connector",
      outcome: "authorized",
      payloadHash: job.payloadHash,
      metadata: { profileId: profile.id, provider: "rentcast", maximumResults: 10 },
      occurredAt: providerStartedAt
    });
    providerEventId = providerStarted.id;
    await dependencies.repositories.activityEvents.append(providerStarted);
    provider = await dependencies.rentCast.search(buildRentCastRentalQuery(profile));
    const providerCompleted = makeEvent(dependencies, {
      action: LIVE_SEARCH_ACTIONS.providerCompleted,
      runId,
      causationId: providerStarted.id,
      actor: "connector",
      outcome: "succeeded",
      payloadHash: provider.queryHash,
      metadata: {
        profileId: profile.id,
        provider: "rentcast",
        retrievedCount: provider.candidates.length,
        retrievalLatencyMilliseconds: provider.latencyMilliseconds,
        queryHash: provider.queryHash
      },
      occurredAt: isoNow(dependencies)
    });
    providerEventId = providerCompleted.id;
    await dependencies.repositories.activityEvents.append(providerCompleted);
  } catch (error: unknown) {
    return failRun(dependencies, job, mapFailure(error), providerEventId);
  }
  if (provider.candidates.length === 0) {
    return completeNoResults(dependencies, job, provider, providerEventId);
  }

  let agent: MaritimeOpenClawAnalysisResult;
  let agentEventId = providerEventId;
  try {
    const agentStarted = makeEvent(dependencies, {
      action: LIVE_SEARCH_ACTIONS.agentStarted,
      runId,
      causationId: providerEventId,
      actor: "connector",
      outcome: "authorized",
      payloadHash: provider.queryHash,
      metadata: {
        profileId: profile.id,
        agent: "OpenClaw on Maritime",
        candidateCount: provider.candidates.length,
        promptVersion: DEFAULT_LIVE_AGENT_PROMPT_VERSION
      },
      occurredAt: isoNow(dependencies)
    });
    agentEventId = agentStarted.id;
    await dependencies.repositories.activityEvents.append(agentStarted);
    agent = await dependencies.maritime.analyze({
      searchRunId: runId,
      criteria: agentCriteria(profile),
      candidates: provider.candidates
    });
    const analysisHash = safeHash(agent.analysis);
    const agentCompleted = makeEvent(dependencies, {
      action: LIVE_SEARCH_ACTIONS.agentCompleted,
      runId,
      causationId: agentStarted.id,
      actor: "connector",
      outcome: "succeeded",
      payloadHash: analysisHash,
      metadata: {
        profileId: profile.id,
        agent: "OpenClaw on Maritime",
        acceptedRecommendationCount: agent.analysis.recommendations.length,
        agentLatencyMilliseconds: agent.latencyMilliseconds,
        promptVersion: agent.promptVersion,
        schemaVersion: agent.analysis.schemaVersion,
        analysisHash
      },
      occurredAt: isoNow(dependencies)
    });
    agentEventId = agentCompleted.id;
    await dependencies.repositories.activityEvents.append(agentCompleted);
  } catch (error: unknown) {
    return failRun(dependencies, job, mapFailure(error), agentEventId);
  }

  const byProviderId = new Map(
    agent.analysis.recommendations.map((recommendation) => [
      recommendation.providerListingId,
      recommendation
    ])
  );
  let importedCount = 0;
  let rejectedCount = 0;
  let causationId = agentEventId;
  for (const candidate of provider.candidates) {
    try {
      const envelope = dependencies.rentCast.toEnvelope(
        candidate,
        provider.queryHash,
        byProviderId.get(candidate.providerListingId) ?? null
      );
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
          connectorId: envelope.connectorId,
          capability: envelope.capability,
          searchProfileId: profile.id
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
          const queued = existingRecord
            ? await repositories.normalizationJobs.getByRawListingId(imported.record.id)
            : (
                await repositories.normalizationJobs.enqueue({
                  id: dependencies.createId(),
                  rawListingId: imported.record.id,
                  idempotencyKey: sha256Text(`normalization-job:v1:${imported.record.id}`),
                  availableAt: isoNow(dependencies),
                  maxAttempts: 3,
                  correlationId: runId,
                  causationId: importEventId,
                  createdAt: isoNow(dependencies)
                })
              ).record;
          const importedEvent = ActivityEventSchema.parse({
            ...makeEvent(dependencies, {
              action: LIVE_SEARCH_ACTIONS.imported,
              runId,
              causationId,
              actor: "connector",
              outcome: "succeeded",
              payloadHash: imported.record.contentHash,
              metadata: {
                profileId: profile.id,
                provider: "rentcast",
                providerListingIdHash: sha256Text(candidate.providerListingId),
                duplicate: !imported.inserted,
                normalizationJobId: queued?.id ?? null
              },
              occurredAt: isoNow(dependencies),
              targetType: "raw_listing",
              targetId: imported.record.id
            }),
            id: importEventId
          });
          await repositories.activityEvents.append(importedEvent);
          return { inserted: imported.inserted, eventId: importedEvent.id };
        }
      );
      if (result.inserted) importedCount += 1;
      causationId = result.eventId;
    } catch {
      rejectedCount += 1;
      const rejectedEvent = makeEvent(dependencies, {
        action: "live_listing_rejected",
        runId,
        causationId,
        actor: "system",
        outcome: "failed",
        errorCategory: "validation",
        payloadHash: sha256Text(candidate.providerListingId),
        metadata: {
          profileId: profile.id,
          provider: "rentcast",
          providerListingIdHash: sha256Text(candidate.providerListingId)
        },
        occurredAt: isoNow(dependencies)
      });
      await dependencies.repositories.activityEvents.append(rejectedEvent);
      causationId = rejectedEvent.id;
    }
  }

  if (importedCount === 0 && rejectedCount > 0) {
    return failRun(
      dependencies,
      job,
      { state: "provider_unavailable", retryable: false, category: "validation" },
      causationId
    );
  }

  const importedAt = isoNow(dependencies);
  await dependencies.repositories.sourceJobs.transition(runId, "completed", importedAt, {
    attempts: 1,
    result: {
      jobId: runId,
      connectorId: job.connectorId,
      source: job.source,
      acquisitionMode: job.acquisitionMode,
      operation: job.operation,
      status: "completed",
      correlationId: runId,
      payloadHash: job.payloadHash,
      idempotencyKey: job.idempotencyKey,
      resultHash: safeHash({
        queryHash: provider.queryHash,
        analysis: agent.analysis,
        importedCount,
        rejectedCount
      }),
      recordCount: importedCount,
      previousCursor: null,
      cursorCandidate: null,
      error: null,
      capture: null,
      completedAt: importedAt,
      idempotentReplay: false,
      untrustedInput: true
    }
  });

  return LiveSearchStatusSchema.parse({
    searchRunId: runId,
    searchProfileId: profile.id,
    state: "importing",
    dataProvider: "RentCast",
    maritimeAgent: "OpenClaw on Maritime",
    retrievedCount: provider.candidates.length,
    importedCount,
    rejectedCount,
    retrievalLatencyMilliseconds: provider.latencyMilliseconds,
    agentLatencyMilliseconds: agent.latencyMilliseconds,
    totalLatencyMilliseconds: Math.max(0, Date.parse(importedAt) - Date.parse(requestedAt)),
    completedAt: null,
    queryHash: provider.queryHash,
    promptVersion: agent.promptVersion,
    agentSchemaVersion: "1"
  });
}

function numberMetadata(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function stringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function getLiveSearchStatus(
  searchRunId: string,
  dependencies: Pick<LiveSearchServiceDependencies, "repositories">
): Promise<LiveSearchStatus> {
  const job = await dependencies.repositories.sourceJobs.getById(searchRunId);
  if (!job || job.connectorId !== RENTCAST_CONNECTOR_ID) {
    throw new LiveSearchServiceError("profile_not_found", 404, null, false);
  }
  const events = (await dependencies.repositories.activityEvents.list()).filter(
    (event) => event.correlationId === searchRunId
  );
  const provider = events.findLast(
    (event) => event.action === LIVE_SEARCH_ACTIONS.providerCompleted
  );
  const agent = events.findLast((event) => event.action === LIVE_SEARCH_ACTIONS.agentCompleted);
  const failure = events.findLast((event) => event.action === LIVE_SEARCH_ACTIONS.failed);
  const completed = events.findLast((event) => event.action === LIVE_SEARCH_ACTIONS.completed);
  const imports = events.filter(
    (event) => event.action === LIVE_SEARCH_ACTIONS.imported && event.metadata.duplicate !== true
  );
  const rejections = events.filter((event) => event.action === "live_listing_rejected");
  const failureState = failure
    ? LiveSearchStatusSchema.shape.state.safeParse(failure.metadata.resultState)
    : null;
  const state: LiveSearchResultState =
    failureState?.success === true
      ? failureState.data
      : completed
        ? "completed"
        : job.status === "completed"
          ? "importing"
          : agent
            ? "importing"
            : events.some((event) => event.action === LIVE_SEARCH_ACTIONS.agentStarted)
              ? "analyzing"
              : events.some((event) => event.action === LIVE_SEARCH_ACTIONS.providerStarted)
                ? "retrieving"
                : "queued";
  const retrievedCount = numberMetadata(provider?.metadata.retrievedCount) ?? 0;
  const rejectedCount = rejections.length;
  const completedAt = completed?.occurredAt ?? failure?.occurredAt ?? null;
  return LiveSearchStatusSchema.parse({
    searchRunId,
    searchProfileId: jobProfileId(job),
    state,
    dataProvider: "RentCast",
    maritimeAgent: "OpenClaw on Maritime",
    retrievedCount,
    importedCount: imports.length,
    rejectedCount,
    retrievalLatencyMilliseconds:
      numberMetadata(provider?.metadata.retrievalLatencyMilliseconds) ?? null,
    agentLatencyMilliseconds: numberMetadata(agent?.metadata.agentLatencyMilliseconds) ?? null,
    totalLatencyMilliseconds:
      completedAt === null
        ? null
        : Math.max(0, Date.parse(completedAt) - Date.parse(job.createdAt)),
    completedAt,
    queryHash: stringMetadata(provider?.metadata.queryHash),
    promptVersion:
      stringMetadata(agent?.metadata.promptVersion) ?? DEFAULT_LIVE_AGENT_PROMPT_VERSION,
    agentSchemaVersion: "1"
  });
}

export function parseLiveSearchEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): LiveSearchEnvironment {
  return {
    enabled:
      ["1", "true"].includes(
        environment.VERA_LIVE_AGENT_SEARCH_ENABLED?.trim().toLowerCase() ?? ""
      ) && environment.VERA_INTEGRATIONS_DISABLED?.trim() !== "1",
    founderUserIds: new Set(
      (environment.VERA_LIVE_AGENT_FOUNDER_USER_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  };
}

export function assertLiveSearchFounder(
  userId: VeraUserId,
  environment: LiveSearchEnvironment
): void {
  if (!environment.enabled) throw new LiveSearchServiceError("disabled", 503, null, false);
  if (!environment.founderUserIds.has(userId)) {
    throw new LiveSearchServiceError("forbidden", 403, null, false);
  }
}

export function createLiveSearchDependencies(
  userId: VeraUserId,
  repositories: UserRepositories,
  repositoryProvider: UserRepositoryProvider,
  environment: NodeJS.ProcessEnv = process.env,
  policyRegistry?: SourcePolicyRegistry
): LiveSearchServiceDependencies {
  return {
    userId,
    repositories,
    repositoryProvider,
    rentCast: new RentCastConnector({
      apiKey: environment.RENTCAST_API_KEY ?? "",
      timeoutMilliseconds: Number(environment.VERA_RENTCAST_TIMEOUT_MS ?? 12_000),
      maxResponseBytes: Number(environment.VERA_RENTCAST_MAX_RESPONSE_BYTES ?? 1_000_000),
      ...(policyRegistry ? { policyRegistry } : {})
    }),
    maritime: new MaritimeOpenClawClient({
      apiKey: environment.MARITIME_API_KEY ?? "",
      agentId: environment.MARITIME_OPENCLAW_AGENT_ID ?? "",
      timeoutMilliseconds: Number(environment.VERA_LIVE_AGENT_TIMEOUT_MS ?? 30_000),
      maxResponseBytes: Number(environment.VERA_LIVE_AGENT_MAX_RESPONSE_BYTES ?? 100_000),
      promptVersion: environment.VERA_LIVE_AGENT_PROMPT_VERSION ?? DEFAULT_LIVE_AGENT_PROMPT_VERSION
    }),
    now: () => new Date(),
    createId: randomUUID
  };
}
