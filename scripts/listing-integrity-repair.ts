import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  ActivityEventSchema,
  VeraUserIdSchema,
  classifyObservedListingUrl,
  isExpectedSourceUrl,
  type ListingSourceRecordDispositionEvent,
  type VeraUserId
} from "@vera/domain";
import {
  canonicalJson,
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig,
  sha256Text,
  type PostgresConnection,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import { evaluateCorpus } from "@vera/scoring";

import {
  ListingIntegrityRepairInputSchema,
  ListingIntegrityRepairPreviewSchema,
  assertPredictedRelationships,
  computeRepairCorpusHash,
  createInvalidDisposition,
  filterDecisionSnapshot,
  type ListingIntegrityRepairCounts,
  type ListingIntegrityRepairInput,
  type ListingIntegrityRepairPreview,
  type ListingIntegrityVisibleMetrics
} from "./listing-integrity-repair-lib.ts";

type Mode = "preview" | "apply" | "verify";

interface CliOptions {
  readonly mode: Mode;
  readonly databaseUrlFile: string;
  readonly userIdFile: string;
  readonly inputFile: string | null;
  readonly previewFile: string | null;
  readonly outputFile: string;
}

function privatePath(input: string): string {
  const path = resolve(input);
  const repositoryPrivate = resolve("release-evidence/private");
  if (
    !isAbsolute(path) ||
    !(path.startsWith("/private/tmp/") || path.startsWith(`${repositoryPrivate}/`))
  ) {
    throw new Error("Listing integrity repair files must stay in a private evidence directory.");
  }
  return path;
}

function parseArguments(arguments_: readonly string[]): CliOptions {
  const [rawMode, ...rest] = arguments_;
  if (rawMode !== "preview" && rawMode !== "apply" && rawMode !== "verify") {
    throw new Error("Expected preview, apply, or verify mode.");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Invalid CLI arguments.");
    values.set(key, value);
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing ${key}.`);
    return privatePath(value);
  };
  return {
    mode: rawMode,
    databaseUrlFile: required("--database-url-file"),
    userIdFile: required("--user-id-file"),
    inputFile: rawMode === "preview" ? required("--input-file") : null,
    previewFile: rawMode === "preview" ? null : required("--preview-file"),
    outputFile: required("--output-file")
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function openPrivateDatabase(options: CliOptions): Promise<{
  readonly connection: PostgresConnection;
  readonly userId: VeraUserId;
  readonly provider: UserRepositoryProvider;
  readonly repositories: UserRepositories;
}> {
  const databaseUrl = (await readFile(options.databaseUrlFile, "utf8")).trim();
  const userId = VeraUserIdSchema.parse((await readFile(options.userIdFile, "utf8")).trim());
  const connection = openPostgresConnection(
    parsePostgresConfig({
      DATABASE_URL: databaseUrl,
      VERA_DB_POOL_MAX: "3",
      VERA_DB_CONNECTION_TIMEOUT_MS: "5000",
      VERA_DB_STATEMENT_TIMEOUT_MS: "30000",
      VERA_DB_LOCK_TIMEOUT_MS: "3000",
      VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS: "10000"
    })
  );
  const provider = createPostgresRepositoryProvider(connection);
  return { connection, userId, provider, repositories: provider.forUser(userId) };
}

async function preservedCounts(
  repositories: UserRepositories
): Promise<ListingIntegrityRepairCounts> {
  const [rawListings, sourceRecords, fieldProvenance, activityEvents] = await Promise.all([
    repositories.rawListings.count(),
    repositories.sourceRecords.count(),
    repositories.fieldProvenance.count(),
    repositories.activityEvents.count()
  ]);
  return { rawListings, sourceRecords, fieldProvenance, activityEvents };
}

async function visibleMetrics(
  repositories: UserRepositories
): Promise<ListingIntegrityVisibleMetrics> {
  const summaries = await repositories.canonicalListings.listSummaries();
  const records = (
    await Promise.all(
      summaries.map((summary) => repositories.sourceRecords.listByCanonicalListingId(summary.id))
    )
  ).flat();
  const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()];
  const perSource: ListingIntegrityVisibleMetrics["perSource"] = {};
  for (const record of uniqueRecords) {
    const state = await repositories.listingEnrichments.getBySourceRecordId(record.id);
    const current = perSource[record.source] ?? {
      activeRecords: 0,
      enrichedRecords: 0,
      sourceLinks: 0
    };
    perSource[record.source] = {
      activeRecords: current.activeRecords + 1,
      enrichedRecords:
        current.enrichedRecords +
        (state?.state === "enriched" || state?.state === "partial" ? 1 : 0),
      sourceLinks:
        current.sourceLinks +
        (record.sourceUrl !== null && isExpectedSourceUrl(record.source, record.sourceUrl) ? 1 : 0)
    };
  }
  return {
    activeListings: summaries.length,
    cardsWithPhotos: summaries.filter(({ primaryPhoto }) => primaryPhoto !== null).length,
    cardsWithSourceLinks: summaries.filter(({ originalListingUrl }) => originalListingUrl !== null)
      .length,
    averageDetailCompletenessBasisPoints:
      summaries.length === 0
        ? 0
        : Math.round(
            summaries.reduce(
              (total, { detailCompletenessBasisPoints }) => total + detailCompletenessBasisPoints,
              0
            ) / summaries.length
          ),
    perSource
  };
}

async function currentSnapshot(input: {
  readonly repositories: UserRepositories;
  readonly searchProfileId: string;
}) {
  const state = await input.repositories.decisionJobs.getCorpusState(input.searchProfileId);
  if (!state) throw new Error("Decision corpus state is missing for the repair profile.");
  const snapshot = await input.repositories.decisionReconciliation.readSnapshot({
    searchProfileId: input.searchProfileId,
    targetCorpusRevision: state.revision
  });
  const dispositions = await input.repositories.sourceRecordDispositions.listCurrent();
  return {
    state,
    snapshot,
    dispositions,
    hash: computeRepairCorpusHash(snapshot, dispositions)
  };
}

async function preview(
  userId: VeraUserId,
  repositories: UserRepositories,
  input: ListingIntegrityRepairInput
): Promise<ListingIntegrityRepairPreview> {
  const profile = await repositories.searchProfiles.getById(input.searchProfileId);
  if (!profile) throw new Error("Repair profile does not exist.");
  await repositories.decisionJobs.ensureCorpusState(
    input.searchProfileId,
    new Date().toISOString()
  );
  const current = await currentSnapshot({ repositories, searchProfileId: input.searchProfileId });
  const createdAt = new Date().toISOString();
  const dispositions: ListingSourceRecordDispositionEvent[] = [];
  for (const sourceRecordId of input.invalidSourceRecordIds) {
    const record = await repositories.sourceRecords.getById(sourceRecordId);
    if (!record) throw new Error(`Repair source record ${sourceRecordId} does not exist.`);
    if (record.sourceUrl === null)
      throw new Error(`Repair source record ${sourceRecordId} has no URL.`);
    const classification = classifyObservedListingUrl({
      source: record.source,
      url: record.sourceUrl
    });
    if (classification !== "non_listing") {
      throw new Error(
        `Repair source record ${sourceRecordId} is ${classification}, not non_listing.`
      );
    }
    dispositions.push(
      createInvalidDisposition({
        userId,
        record,
        observedAt: createdAt,
        reasonCode: `${record.source}_non_listing_url`
      })
    );
  }
  const filtered = filterDecisionSnapshot(current.snapshot, input.invalidSourceRecordIds);
  const plan = evaluateCorpus(filtered, { now: createdAt });
  const predictedCanonicalMembers = plan.canonicalPlans.map((canonical) => ({
    canonicalListingId: canonical.canonicalListingId,
    memberSourceRecordIds: [...canonical.memberSourceRecordIds]
  }));
  assertPredictedRelationships(predictedCanonicalMembers, input);
  return ListingIntegrityRepairPreviewSchema.parse({
    version: "listing-integrity-repair.v1",
    userId,
    searchProfileId: input.searchProfileId,
    createdAt,
    corpusRevision: current.state.revision,
    corpusHash: current.hash,
    dispositions,
    assertSeparatedPairs: input.assertSeparatedPairs,
    assertJoinedGroups: input.assertJoinedGroups,
    predictedCanonicalMembers,
    preservedCountsBefore: await preservedCounts(repositories),
    visibleMetricsBefore: await visibleMetrics(repositories)
  });
}

function repairJobId(previewArtifact: ListingIntegrityRepairPreview): string {
  return `decision-repair:${sha256Text(previewArtifact.corpusHash).slice(0, 40)}`;
}

async function apply(
  provider: UserRepositoryProvider,
  repositories: UserRepositories,
  userId: VeraUserId,
  previewArtifact: ListingIntegrityRepairPreview
): Promise<unknown> {
  if (previewArtifact.userId !== userId) throw new Error("Repair preview owner mismatch.");
  const currentDispositionBySource = new Map(
    (await repositories.sourceRecordDispositions.listCurrent()).map((event) => [
      event.listingSourceRecordId,
      event
    ])
  );
  const alreadyApplied = previewArtifact.dispositions.every(
    (event) =>
      currentDispositionBySource.get(event.listingSourceRecordId)?.payloadHash === event.payloadHash
  );
  const jobId = repairJobId(previewArtifact);
  if (alreadyApplied) {
    const projectedObservedPhotoCount =
      await repositories.listingEnrichments.projectCurrentObservedPhotos();
    return { status: "already_applied", decisionJobId: jobId, projectedObservedPhotoCount };
  }
  const current = await currentSnapshot({
    repositories,
    searchProfileId: previewArtifact.searchProfileId
  });
  if (
    current.state.revision !== previewArtifact.corpusRevision ||
    current.hash !== previewArtifact.corpusHash
  ) {
    throw new Error("Repair preview is stale; generate and inspect a new preview.");
  }
  const payloadHash = sha256Text(
    canonicalJson({
      corpusHash: previewArtifact.corpusHash,
      dispositions: previewArtifact.dispositions.map((event) => event.payloadHash)
    })
  );
  const correlationId = `repair:${payloadHash.slice(0, 40)}`;
  const result = await provider.transaction(userId, async (transaction) => {
    for (const event of previewArtifact.dispositions) {
      await transaction.sourceRecordDispositions.append(event);
    }
    await transaction.activityEvents.append(
      ActivityEventSchema.parse({
        id: `activity:${payloadHash.slice(0, 40)}`,
        correlationId,
        causationId: null,
        actor: "user",
        action: "listing.source_records_dispositioned",
        targetType: "listing_integrity_repair",
        targetId: correlationId,
        policyDecision: "authorized",
        approvalId: null,
        payloadHash,
        outcome: "succeeded",
        errorCategory: null,
        metadata: {
          dispositionCount: previewArtifact.dispositions.length,
          sourceRecordIds: previewArtifact.dispositions.map(
            ({ listingSourceRecordId }) => listingSourceRecordId
          ),
          previewCorpusRevision: previewArtifact.corpusRevision,
          previewCorpusHash: previewArtifact.corpusHash
        },
        occurredAt: new Date().toISOString()
      })
    );
    return transaction.decisionJobs.bumpCorpusRevisionAndEnqueue({
      id: jobId,
      searchProfileId: previewArtifact.searchProfileId,
      trigger: "manual_recompute",
      now: new Date().toISOString()
    });
  });
  const projectedObservedPhotoCount =
    await repositories.listingEnrichments.projectCurrentObservedPhotos();
  return {
    status: "applied",
    insertedDispositionCount: previewArtifact.dispositions.length,
    decisionJobId: result.id,
    targetCorpusRevision: result.targetCorpusRevision,
    projectedObservedPhotoCount
  };
}

async function forbiddenActionCount(connection: PostgresConnection, userId: VeraUserId) {
  const result = await connection.pool.query<{ count: number }>(
    `select count(*)::int as count
       from activity_events
      where user_id = $1::uuid
        and action in ('browser.research_action_checked', 'browser.zillow_research_action_checked')
        and lower(coalesce(metadata ->> 'action', '')) = any($2::text[])`,
    [
      userId,
      [
        "contact",
        "apply",
        "tour",
        "message",
        "messenger",
        "phone",
        "email",
        "payment",
        "upload",
        "download"
      ]
    ]
  );
  return result.rows[0]?.count ?? 0;
}

async function verify(
  connection: PostgresConnection,
  repositories: UserRepositories,
  userId: VeraUserId,
  previewArtifact: ListingIntegrityRepairPreview
): Promise<unknown> {
  if (previewArtifact.userId !== userId) throw new Error("Repair preview owner mismatch.");
  const currentBySource = new Map(
    (await repositories.sourceRecordDispositions.listCurrent()).map((event) => [
      event.listingSourceRecordId,
      event
    ])
  );
  for (const event of previewArtifact.dispositions) {
    if (currentBySource.get(event.listingSourceRecordId)?.payloadHash !== event.payloadHash) {
      throw new Error(`Disposition verification failed for ${event.listingSourceRecordId}.`);
    }
  }
  const jobId = repairJobId(previewArtifact);
  const deadline = Date.now() + 60_000;
  let job = await repositories.decisionJobs.getById(jobId);
  while (job && (job.status === "queued" || job.status === "running") && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    job = await repositories.decisionJobs.getById(jobId);
  }
  if (job?.status !== "succeeded") {
    throw new Error(`Repair decision job is not succeeded (${job?.status ?? "missing"}).`);
  }
  const actualMembers = [];
  for (const predicted of previewArtifact.predictedCanonicalMembers) {
    const canonical = await repositories.canonicalListings.getById(predicted.canonicalListingId);
    if (!canonical || canonical.projectionState !== "active") {
      throw new Error(`Predicted canonical ${predicted.canonicalListingId} is not active.`);
    }
    const memberSourceRecordIds = (
      await repositories.sourceRecords.listByCanonicalListingId(predicted.canonicalListingId)
    )
      .map(({ id }) => id)
      .sort();
    const expected = [...predicted.memberSourceRecordIds].sort();
    if (canonicalJson(memberSourceRecordIds) !== canonicalJson(expected)) {
      throw new Error(`Canonical membership mismatch for ${predicted.canonicalListingId}.`);
    }
    actualMembers.push({
      canonicalListingId: predicted.canonicalListingId,
      memberSourceRecordIds
    });
  }
  assertPredictedRelationships(actualMembers, {
    searchProfileId: previewArtifact.searchProfileId,
    invalidSourceRecordIds: previewArtifact.dispositions.map(
      ({ listingSourceRecordId }) => listingSourceRecordId
    ),
    assertSeparatedPairs: previewArtifact.assertSeparatedPairs,
    assertJoinedGroups: previewArtifact.assertJoinedGroups
  });
  const afterCounts = await preservedCounts(repositories);
  for (const key of [
    "rawListings",
    "sourceRecords",
    "fieldProvenance",
    "activityEvents"
  ] as const) {
    if (afterCounts[key] < previewArtifact.preservedCountsBefore[key]) {
      throw new Error(`Preserved ${key} count decreased.`);
    }
  }
  const forbiddenActions = await forbiddenActionCount(connection, userId);
  if (forbiddenActions !== 0) throw new Error("Forbidden browser actions are nonzero.");
  return {
    status: "verified",
    decisionJobId: jobId,
    targetCorpusRevision: job.targetCorpusRevision,
    preservedCountsBefore: previewArtifact.preservedCountsBefore,
    preservedCountsAfter: afterCounts,
    visibleMetricsBefore: previewArtifact.visibleMetricsBefore,
    visibleMetricsAfter: await visibleMetrics(repositories),
    forbiddenActionCount: forbiddenActions
  };
}

export async function runListingIntegrityRepair(arguments_: readonly string[]): Promise<void> {
  const options = parseArguments(arguments_);
  const runtime = await openPrivateDatabase(options);
  try {
    if (options.mode === "preview") {
      const input = ListingIntegrityRepairInputSchema.parse(await readJson(options.inputFile!));
      const artifact = await preview(runtime.userId, runtime.repositories, input);
      await writeJson(options.outputFile, artifact);
      return;
    }
    const artifact = ListingIntegrityRepairPreviewSchema.parse(
      await readJson(options.previewFile!)
    );
    const result =
      options.mode === "apply"
        ? await apply(runtime.provider, runtime.repositories, runtime.userId, artifact)
        : await verify(runtime.connection, runtime.repositories, runtime.userId, artifact);
    await writeJson(options.outputFile, result);
  } finally {
    await runtime.connection.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runListingIntegrityRepair(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Listing integrity repair failed.";
    process.stderr.write(`${JSON.stringify({ status: "failed", message })}\n`);
    process.exitCode = 1;
  });
}
