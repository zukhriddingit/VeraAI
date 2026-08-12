import { randomUUID } from "node:crypto";

import {
  BROWSER_SOURCE_CONNECTOR_IDS,
  BROWSER_SOURCE_OPERATIONS,
  createLoopbackBrowserResearchClient,
  createMaritimeBrowserResearchClient,
  getBrowserSourceAdapter,
  MaritimeBrowserResearchError
} from "@vera/connectors";
import {
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  EnrichmentResponseSchema,
  ListingDetailFieldsSchema,
  ListingDetailPhotoSchema,
  ListingEnrichmentSnapshotSchema,
  SelectedHousingSourceConfigurationSchema,
  SourceJobSchema,
  ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE,
  computeListingDetailCompleteness,
  isExpectedSourceUrl,
  type BrowserResearchOutput,
  type BrowserResearchPlan,
  type BrowserResearchSource,
  type EnrichmentResponse,
  type ListingEnrichmentReason,
  type ListingEnrichmentRecord,
  type ListingEnrichmentSnapshot,
  type ListingSourceRecord,
  type ManualActionBlocker,
  type SearchProfile,
  type SelectedHousingSourceConfiguration,
  type VeraUserId
} from "@vera/domain";

import { parseBrowserResearchCheckpointEnvironment } from "./browser-research-checkpoint-service.ts";

const MAX_CONCURRENT_ENRICHMENTS = 2;
const ENRICHMENT_MAX_ATTEMPTS = 3;
let activeEnrichments = 0;

export interface ListingEnrichmentDependencies {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly browserResearch: {
    run(
      plan: BrowserResearchPlan,
      options: { readonly signal: AbortSignal }
    ): Promise<BrowserResearchOutput>;
  };
  readonly founderUserId: VeraUserId | null;
  readonly browserDisabled: boolean;
  readonly enabledSources: ReadonlySet<BrowserResearchSource>;
  readonly planSigningKey: string;
  now(): Date;
  createId(): string;
}

function nowIso(dependencies: ListingEnrichmentDependencies): string {
  const now = dependencies.now();
  if (Number.isNaN(now.getTime())) throw new Error("Listing-enrichment clock is invalid.");
  return now.toISOString();
}

function payloadHash(value: unknown): string {
  return sha256Text(canonicalJson(value as never));
}

function browserSource(record: ListingSourceRecord): BrowserResearchSource | null {
  if (
    record.source === "zillow" ||
    record.source === "apartments_com" ||
    record.source === "facebook_marketplace" ||
    record.source === "bu_off_campus" ||
    record.source === "custom_website" ||
    record.source === "craigslist"
  ) {
    return record.source;
  }
  return null;
}

function freshnessMilliseconds(source: BrowserResearchSource): number {
  if (source === "facebook_marketplace" || source === "craigslist") {
    return 2 * 60 * 60 * 1_000;
  }
  if (source === "zillow") return 6 * 60 * 60 * 1_000;
  if (source === "custom_website") return 6 * 60 * 60 * 1_000;
  return 12 * 60 * 60 * 1_000;
}

async function customConfigurationForRecord(
  record: ListingSourceRecord,
  dependencies: ListingEnrichmentDependencies
): Promise<SelectedHousingSourceConfiguration | undefined> {
  if (record.source !== "custom_website" || record.sourceUrl === null) return undefined;
  const raw = await dependencies.repositories.rawListings.getById(record.rawListingId);
  const stored = raw?.captureMetadata.sourceConfiguration;
  const parsed = SelectedHousingSourceConfigurationSchema.safeParse(
    stored && typeof stored === "object"
      ? { ...stored, source: "custom_website", captureCurrentPage: false }
      : null
  );
  if (parsed.success) return parsed.data;
  const url = new URL(record.sourceUrl);
  const suffix = url.hostname.replace(/[^a-z0-9.-]/gu, "-").slice(0, 120);
  return {
    source: "custom_website",
    sourceId: `custom:${suffix}`,
    displayName: url.hostname,
    adapterKind: "generic",
    startingUrl: record.sourceUrl,
    allowedDomain: url.hostname,
    loginRequired: "unknown",
    defaultInclude: false,
    captureCurrentPage: false
  };
}

function manualActionBlocker(
  action: NonNullable<BrowserResearchOutput["manualAction"]>
): ManualActionBlocker {
  if (
    action === "login_required" ||
    action === "two_factor_required" ||
    action === "captcha_required" ||
    action === "consent_required"
  ) {
    return action;
  }
  if (action === "blocked") return "rate_or_bot_challenge";
  if (action === "layout_changed") return "layout_incompatible";
  if (action === "browser_offline") return "node_offline";
  if (action === "shared_tab_changed") return "stale_snapshot";
  return "user_intervention_required";
}

function petDetails(
  text: string | null,
  fees: BrowserResearchOutput["listings"][number]["petFees"]
) {
  if (text === null && fees.length === 0) return null;
  const lower = text?.toLowerCase() ?? "";
  const denied = /\bno pets?\b/u.test(lower);
  const cats = denied
    ? "not_allowed"
    : /\bcats? (?:allowed|welcome)\b/u.test(lower)
      ? "allowed"
      : "unknown";
  const dogs = denied
    ? "not_allowed"
    : /\bdogs? (?:allowed|welcome)\b/u.test(lower)
      ? "allowed"
      : "unknown";
  return {
    policy: { cats, dogs, notes: text },
    fees: fees.map((fee) => ({
      kind: "pet" as const,
      label: fee.label,
      amountCents: fee.amountUsd === null ? null : fee.amountUsd * 100,
      cadence: fee.cadence,
      required: fee.required
    }))
  };
}

function snapshotFromOutput(
  record: ListingSourceRecord,
  output: BrowserResearchOutput,
  dependencies: ListingEnrichmentDependencies
): ListingEnrichmentSnapshot {
  const source = browserSource(record);
  const listing = output.listings[0];
  if (
    source === null ||
    listing === undefined ||
    listing.source !== source ||
    listing.finalDetailPageUrl === null ||
    !isExpectedSourceUrl(source, listing.finalDetailPageUrl)
  ) {
    throw new Error("enrichment_output_invalid");
  }
  const observedAt = listing.observedAt;
  const recurringFees = listing.recurringFees.map((fee) => ({
    kind: /^Pet\b/iu.test(fee.label)
      ? ("pet" as const)
      : /^Parking\b/iu.test(fee.label)
        ? ("parking" as const)
        : ("required_recurring" as const),
    label: fee.label,
    amountCents: fee.amountUsd === null ? null : fee.amountUsd * 100,
    cadence: fee.cadence,
    required: fee.required
  }));
  const details = ListingDetailFieldsSchema.parse({
    sourceUrl: listing.finalDetailPageUrl,
    sourceListingId: listing.sourceListingId ?? record.sourceListingId,
    propertyName: listing.propertyName,
    description: listing.description,
    baseRentCents: listing.rentUsd === null ? record.monthlyRentCents : listing.rentUsd * 100,
    fees: [
      ...recurringFees,
      ...(listing.depositUsd === null
        ? []
        : [
            {
              kind: "deposit" as const,
              label: "Deposit",
              amountCents: listing.depositUsd * 100,
              cadence: "one_time" as const,
              required: true
            }
          ]),
      ...(listing.applicationFeeUsd === null
        ? []
        : [
            {
              kind: "application" as const,
              label: "Application fee",
              amountCents: listing.applicationFeeUsd * 100,
              cadence: "one_time" as const,
              required: true
            }
          ]),
      ...(listing.brokerFeeUsd === null
        ? []
        : [
            {
              kind: "broker" as const,
              label: "Broker fee",
              amountCents: listing.brokerFeeUsd * 100,
              cadence: "one_time" as const,
              required: true
            }
          ])
    ],
    estimatedTotalMonthlyCostCents:
      listing.estimatedTotalMonthlyCostUsd === null
        ? null
        : listing.estimatedTotalMonthlyCostUsd * 100,
    depositCents: listing.depositUsd === null ? null : listing.depositUsd * 100,
    applicationFeeCents:
      listing.applicationFeeUsd === null ? null : listing.applicationFeeUsd * 100,
    brokerFeeCents: listing.brokerFeeUsd === null ? null : listing.brokerFeeUsd * 100,
    availableOn: listing.availableDate,
    availabilityText: listing.availability,
    leaseDurationText: listing.leaseDuration,
    leaseTermMonths: listing.leaseTermMonths,
    bedrooms: listing.bedrooms ?? record.bedrooms,
    bathrooms: listing.bathrooms ?? record.bathrooms,
    squareFeet: listing.squareFeet ?? record.squareFeet,
    propertyType: listing.propertyType ?? record.propertyType,
    petDetails: petDetails(listing.petPolicyText, listing.petFees),
    parking:
      listing.parkingText === null && listing.parkingMonthlyUsd === null
        ? null
        : {
            availability:
              listing.parkingText === null
                ? "unknown"
                : /\bno parking\b/iu.test(listing.parkingText)
                  ? "not_available"
                  : "available",
            description: listing.parkingText,
            monthlyCostCents:
              listing.parkingMonthlyUsd === null ? null : listing.parkingMonthlyUsd * 100
          },
    utilitiesIncluded: listing.utilitiesIncluded,
    laundry: listing.laundry,
    furnishedStatus: listing.furnishedStatus,
    amenities: listing.amenities,
    propertyManagerName: listing.propertyManagerName,
    allowedContactChannel: listing.allowedContactChannel,
    sourceUpdatedAt: listing.sourceUpdatedAt
  });
  const photos = listing.photos.map((photo, position) =>
    ListingDetailPhotoSchema.parse({
      sourceUrl: photo.url,
      position,
      width: photo.width,
      height: photo.height,
      safeContentHash: null,
      observedAt
    })
  );
  return ListingEnrichmentSnapshotSchema.parse({
    id: dependencies.createId(),
    listingSourceRecordId: record.id,
    source,
    details,
    photos,
    fieldProvenance: listing.sourceFieldProvenance.map((entry) => ({
      fieldPath: entry.field,
      sourceUrl: entry.sourceUrl,
      extractionMethod: entry.extractionMethod,
      confidenceBasisPoints: entry.confidenceBasisPoints,
      observedAt: entry.observedAt
    })),
    completeness: computeListingDetailCompleteness(details, photos),
    observedAt,
    freshUntil: new Date(Date.parse(observedAt) + freshnessMilliseconds(source)).toISOString(),
    createdAt: nowIso(dependencies)
  });
}

async function appendActivity(
  dependencies: ListingEnrichmentDependencies,
  input: {
    readonly action: string;
    readonly targetType: "canonical_listing" | "listing_source_record";
    readonly targetId: string;
    readonly outcome: "recorded" | "authorized" | "succeeded" | "failed" | "denied";
    readonly metadata: Record<string, string | number | boolean | null>;
    readonly correlationId?: string;
  }
): Promise<void> {
  const occurredAt = nowIso(dependencies);
  await dependencies.repositories.activityEvents.append(
    ActivityEventSchema.parse({
      id: dependencies.createId(),
      correlationId: input.correlationId ?? dependencies.createId(),
      causationId: null,
      actor: input.action === "listing.enrichment_requested" ? "user" : "connector",
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      policyDecision: input.outcome === "denied" ? "denied" : "authorized",
      approvalId: null,
      payloadHash: payloadHash({
        action: input.action,
        targetId: input.targetId,
        ...input.metadata
      }),
      outcome: input.outcome,
      errorCategory: input.outcome === "failed" ? "permanent_provider" : null,
      metadata: input.metadata,
      occurredAt
    })
  );
}

async function queueSourceRecord(
  record: ListingSourceRecord,
  reason: ListingEnrichmentReason,
  force: boolean,
  dependencies: ListingEnrichmentDependencies
) {
  const source = browserSource(record);
  if (
    source === null ||
    record.sourceUrl === null ||
    !isExpectedSourceUrl(source, record.sourceUrl) ||
    dependencies.browserDisabled ||
    dependencies.founderUserId !== dependencies.userId ||
    !dependencies.enabledSources.has(source)
  ) {
    return null;
  }
  return dependencies.repositories.listingEnrichments.queue({
    listingSourceRecordId: record.id,
    reason,
    requestedAt: nowIso(dependencies),
    force
  });
}

export async function requestCanonicalListingEnrichment(
  listingId: string,
  reason: ListingEnrichmentReason,
  dependencies: ListingEnrichmentDependencies,
  force = false
): Promise<EnrichmentResponse> {
  await dependencies.repositories.listingEnrichments.markExpiredStale(nowIso(dependencies));
  const listing = await dependencies.repositories.canonicalListings.getById(listingId);
  if (!listing || listing.projectionState !== "active") throw new Error("listing_not_found");
  const records = await dependencies.repositories.sourceRecords.listByCanonicalListingId(listingId);
  const results = (
    await Promise.all(
      records.map((record) => queueSourceRecord(record, reason, force, dependencies))
    )
  ).filter((result) => result !== null);
  const queuedSourceRecordIds = results
    .filter((result) => result.queued)
    .map((result) => result.record.listingSourceRecordId);
  const reusedFreshSourceRecordIds = results
    .filter((result) => result.reusedFresh)
    .map((result) => result.record.listingSourceRecordId);
  if (queuedSourceRecordIds.length > 0) {
    await appendActivity(dependencies, {
      action: "listing.enrichment_requested",
      targetType: "canonical_listing",
      targetId: listingId,
      outcome: "recorded",
      metadata: { reason, queuedCount: queuedSourceRecordIds.length, force }
    });
  }
  const states = results.map((result) => result.record.state);
  const state = states.includes("enriching")
    ? "enriching"
    : queuedSourceRecordIds.length > 0
      ? "queued"
      : (results[0]?.record.state ?? "not_requested");
  scheduleListingEnrichmentBatch(dependencies);
  return EnrichmentResponseSchema.parse({
    listingId,
    state,
    queuedSourceRecordIds,
    reusedFreshSourceRecordIds,
    requestedAt: nowIso(dependencies)
  });
}

export async function queueTopListingsPerSource(
  dependencies: ListingEnrichmentDependencies,
  limitPerSource = 3
): Promise<number> {
  await dependencies.repositories.listingEnrichments.markExpiredStale(nowIso(dependencies));
  const summaries = [...(await dependencies.repositories.canonicalListings.listSummaries())].sort(
    (left, right) =>
      (right.fitScoreBasisPoints ?? -10_001) - (left.fitScoreBasisPoints ?? -10_001) ||
      right.freshestObservedAt.localeCompare(left.freshestObservedAt)
  );
  const counts = new Map<BrowserResearchSource, number>();
  let queued = 0;
  for (const summary of summaries) {
    const records = await dependencies.repositories.sourceRecords.listByCanonicalListingId(
      summary.id
    );
    for (const record of records) {
      const source = browserSource(record);
      if (source === null || (counts.get(source) ?? 0) >= limitPerSource) continue;
      const result = await queueSourceRecord(record, "search_top_three", false, dependencies);
      if (result === null) continue;
      counts.set(source, (counts.get(source) ?? 0) + 1);
      if (result?.queued) queued += 1;
    }
    if (
      [...dependencies.enabledSources].every(
        (source) => (counts.get(source) ?? 0) >= limitPerSource
      )
    ) {
      break;
    }
  }
  if (queued > 0) scheduleListingEnrichmentBatch(dependencies);
  return queued;
}

async function currentProfile(dependencies: ListingEnrichmentDependencies): Promise<SearchProfile> {
  const profiles = await dependencies.repositories.searchProfiles.list();
  if (profiles.length !== 1) throw new Error("enrichment_profile_unavailable");
  return profiles[0]!;
}

async function processEnrichment(
  claimed: ListingEnrichmentRecord,
  dependencies: ListingEnrichmentDependencies
): Promise<void> {
  const sourceRecord = await dependencies.repositories.sourceRecords.getById(
    claimed.listingSourceRecordId
  );
  const source = sourceRecord ? browserSource(sourceRecord) : null;
  const leaseOwner = claimed.leaseOwner;
  if (
    !sourceRecord ||
    source === null ||
    sourceRecord.sourceUrl === null ||
    leaseOwner === null ||
    !isExpectedSourceUrl(source, sourceRecord.sourceUrl)
  ) {
    if (leaseOwner !== null) {
      await dependencies.repositories.listingEnrichments.fail({
        listingSourceRecordId: claimed.listingSourceRecordId,
        leaseOwner,
        errorCode: "unsafe_source_url",
        retryable: false,
        failedAt: nowIso(dependencies),
        retryAt: new Date(dependencies.now().getTime() + 30_000).toISOString()
      });
    }
    return;
  }
  const profile = await currentProfile(dependencies);
  const adapter = getBrowserSourceAdapter(
    source,
    await customConfigurationForRecord(sourceRecord, dependencies)
  );
  const startedAt = nowIso(dependencies);
  const jobId = dependencies.createId();
  const plan = adapter.createPlan({
    veraRunId: jobId,
    profile,
    startingTabReference: {
      kind: "single_shared_tab",
      value: ZILLOW_SINGLE_SHARED_TAB_CONSENT_REFERENCE
    },
    signingKey: dependencies.planSigningKey,
    issuedAt: new Date(startedAt),
    mode: "enrichment",
    targetListingUrl: sourceRecord.sourceUrl,
    maxResults: 1,
    maxDetailPages: 1
  });
  const jobPayload = {
    acquisitionMode: "local_browser" as const,
    captureKind: "detail_enrichment" as const,
    nodeId: "remote-extension-gateway",
    profileId: "official-chrome-extension",
    startingTabReference: plan.startingTabReference,
    targetListingUrl: sourceRecord.sourceUrl,
    limits: {
      maxPages: 1,
      maxRecords: 1,
      maxBytes: 250_000,
      maxDurationMilliseconds: 90_000,
      maxConcurrency: 1 as const
    },
    maxDetailPages: 1,
    maxResultPageExpansions: 0 as const
  };
  const jobHash = payloadHash(jobPayload);
  const approvalId = dependencies.createId();
  const jobIdempotencyKey = payloadHash({
    protocol: "listing-enrichment.v1",
    sourceRecordId: sourceRecord.id,
    enrichmentJobId: jobId
  });
  await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    await repositories.approvals.insert({
      id: approvalId,
      actor: "user",
      connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
      operation: BROWSER_SOURCE_OPERATIONS[source],
      targetType: "source_job",
      targetId: jobId,
      payloadHash: jobHash,
      state: "used",
      createdAt: startedAt,
      expiresAt: new Date(Date.parse(startedAt) + 120_000).toISOString(),
      usedAt: startedAt
    });
    const queued = await repositories.sourceJobs.enqueue(
      SourceJobSchema.parse({
        id: jobId,
        correlationId: claimed.listingSourceRecordId,
        connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
        source,
        acquisitionMode: "local_browser",
        manifestVersion: 1,
        trigger: "manual",
        capability: "browser.capture",
        approvalId,
        operation: BROWSER_SOURCE_OPERATIONS[source],
        payload: jobPayload,
        payloadHash: jobHash,
        idempotencyKey: jobIdempotencyKey,
        status: "queued",
        availableAt: startedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        attempts: 0,
        maxAttempts: 1,
        manualAction: null,
        deferredReason: null,
        cursorCandidate: null,
        lastError: null,
        createdAt: startedAt,
        updatedAt: startedAt,
        completedAt: null
      })
    );
    if (!queued.inserted) throw new Error("duplicate_enrichment_source_job");
    await repositories.sourceJobs.transition(jobId, "dispatched", startedAt);
    await repositories.sourceJobs.transition(jobId, "running", startedAt, { attempts: 1 });
  });

  try {
    const output = await dependencies.browserResearch.run(plan, {
      signal: new AbortController().signal
    });
    const completedAt = nowIso(dependencies);
    if (output.state === "manual_action_required" && output.manualAction !== null) {
      await dependencies.repositories.listingEnrichments.block({
        listingSourceRecordId: sourceRecord.id,
        leaseOwner,
        manualAction: output.manualAction,
        completedAt
      });
      await dependencies.repositories.sourceJobs.transition(
        jobId,
        "manual_action_required",
        completedAt,
        {
          attempts: 1,
          manualAction: {
            jobId,
            nodeId: "remote-extension-gateway",
            source,
            blocker: manualActionBlocker(output.manualAction),
            instruction: "Resolve the visible browser blocker manually, then use Refresh details.",
            correlationId: claimed.listingSourceRecordId,
            requiredAt: completedAt
          }
        }
      );
      await appendActivity(dependencies, {
        action: "listing.enrichment_blocked",
        targetType: "listing_source_record",
        targetId: sourceRecord.id,
        outcome: "denied",
        metadata: { source, manualAction: output.manualAction },
        correlationId: jobId
      });
      return;
    }
    const snapshot = snapshotFromOutput(sourceRecord, output, dependencies);
    const state = snapshot.completeness.basisPoints >= 8_000 ? "enriched" : "partial";
    await dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
      await repositories.listingEnrichments.complete({
        listingSourceRecordId: sourceRecord.id,
        leaseOwner,
        snapshot,
        state
      });
      await repositories.sourceJobs.transition(jobId, "completed", completedAt, {
        attempts: 1,
        result: {
          jobId,
          connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
          source,
          acquisitionMode: "local_browser",
          operation: BROWSER_SOURCE_OPERATIONS[source],
          status: "completed",
          correlationId: claimed.listingSourceRecordId,
          payloadHash: jobHash,
          idempotencyKey: jobIdempotencyKey,
          resultHash: payloadHash({
            snapshotId: snapshot.id,
            completeness: snapshot.completeness.basisPoints
          }),
          recordCount: 1,
          previousCursor: null,
          cursorCandidate: null,
          error: null,
          capture: null,
          completedAt,
          idempotentReplay: false,
          untrustedInput: true
        }
      });
    });
    await appendActivity(dependencies, {
      action: "listing.enrichment_completed",
      targetType: "listing_source_record",
      targetId: sourceRecord.id,
      outcome: "succeeded",
      metadata: {
        source,
        completenessBasisPoints: snapshot.completeness.basisPoints,
        photoCount: snapshot.photos.length
      },
      correlationId: jobId
    });
  } catch (error: unknown) {
    const failedAt = nowIso(dependencies);
    const retryable = error instanceof MaritimeBrowserResearchError && error.retryable;
    const retryAt = new Date(Date.parse(failedAt) + 30_000).toISOString();
    const failure = await dependencies.repositories.listingEnrichments.fail({
      listingSourceRecordId: sourceRecord.id,
      leaseOwner,
      errorCode:
        error instanceof MaritimeBrowserResearchError ? error.code : "enrichment_invalid_output",
      retryable,
      failedAt,
      retryAt
    });
    await dependencies.repositories.sourceJobs.transition(
      jobId,
      retryable ? "retryable_failed" : "permanently_failed",
      failedAt,
      {
        attempts: 1,
        result: {
          jobId,
          connectorId: BROWSER_SOURCE_CONNECTOR_IDS[source],
          source,
          acquisitionMode: "local_browser",
          operation: BROWSER_SOURCE_OPERATIONS[source],
          status: "failed",
          correlationId: claimed.listingSourceRecordId,
          payloadHash: jobHash,
          idempotencyKey: jobIdempotencyKey,
          resultHash: payloadHash({ failedAt, retryable }),
          recordCount: 0,
          previousCursor: null,
          cursorCandidate: null,
          error: {
            code: error instanceof MaritimeBrowserResearchError ? error.code : "invalid_output",
            category: retryable ? "transient_provider" : "permanent_provider"
          },
          capture: null,
          completedAt: failedAt,
          idempotentReplay: false,
          untrustedInput: true
        }
      }
    );
    await appendActivity(dependencies, {
      action: "listing.enrichment_failed",
      targetType: "listing_source_record",
      targetId: sourceRecord.id,
      outcome: "failed",
      metadata: { source, retryable },
      correlationId: jobId
    });
    if (failure.state === "queued" && failure.attemptCount < ENRICHMENT_MAX_ATTEMPTS) {
      const timer = setTimeout(
        () => scheduleListingEnrichmentBatch(dependencies),
        Math.max(0, Date.parse(retryAt) - dependencies.now().getTime())
      );
      timer.unref();
    }
  }
}

async function drainListingEnrichments(dependencies: ListingEnrichmentDependencies): Promise<void> {
  while (activeEnrichments < MAX_CONCURRENT_ENRICHMENTS) {
    const leaseOwner = `web-enrichment:${dependencies.createId()}`;
    const now = nowIso(dependencies);
    const claimed = await dependencies.repositoryProvider.transaction(
      dependencies.userId,
      (repositories) =>
        repositories.listingEnrichments.claim({
          leaseOwner,
          now,
          leaseExpiresAt: new Date(Date.parse(now) + 120_000).toISOString()
        })
    );
    if (claimed === null) return;
    activeEnrichments += 1;
    void processEnrichment(claimed, dependencies).finally(() => {
      activeEnrichments -= 1;
      scheduleListingEnrichmentBatch(dependencies);
    });
  }
}

export function scheduleListingEnrichmentBatch(dependencies: ListingEnrichmentDependencies): void {
  queueMicrotask(() => {
    void drainListingEnrichments(dependencies).catch(() => {
      // Durable queued/leased state remains visible and recoverable on the next safe trigger.
    });
  });
}

export function createListingEnrichmentDependencies(
  input: {
    readonly userId: VeraUserId;
    readonly repositories: UserRepositories;
    readonly repositoryProvider: UserRepositoryProvider;
  },
  environment: NodeJS.ProcessEnv = process.env
): ListingEnrichmentDependencies {
  const policy = parseBrowserResearchCheckpointEnvironment(environment);
  const localBridgeConfigured =
    (environment.VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_URL?.trim().length ?? 0) > 0 &&
    (environment.VERA_BROWSER_RESEARCH_LOCAL_BRIDGE_TOKEN?.trim().length ?? 0) >= 32;
  const maritimeConfigured =
    (environment.MARITIME_BROWSER_GATEWAY_API_KEY?.trim().length ?? 0) >= 8 &&
    (environment.MARITIME_BROWSER_GATEWAY_AGENT_ID?.trim().length ?? 0) > 0;
  return {
    ...input,
    browserResearch: localBridgeConfigured
      ? createLoopbackBrowserResearchClient(environment)
      : maritimeConfigured
        ? createMaritimeBrowserResearchClient(environment)
        : {
            async run() {
              throw new MaritimeBrowserResearchError("gateway_unavailable", true);
            }
          },
    founderUserId: policy.founderUserId,
    browserDisabled: policy.browserDisabled,
    enabledSources: policy.enabledSources,
    planSigningKey: policy.planSigningKey,
    now: () => new Date(),
    createId: randomUUID
  };
}

export const LISTING_ENRICHMENT_MAX_CONCURRENCY = MAX_CONCURRENT_ENRICHMENTS;
export const LISTING_ENRICHMENT_MAX_ATTEMPTS = ENRICHMENT_MAX_ATTEMPTS;
