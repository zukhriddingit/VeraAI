import type {
  ActivityEvent,
  Approval,
  BrowserNodeStatus,
  CanonicalFieldSource,
  CanonicalListing,
  CanonicalListingSource,
  CanonicalListingSummary,
  ContactWorkflow,
  DecisionCorpusSnapshot,
  DecisionJob,
  DecisionJobAttempt,
  DecisionJobErrorCode,
  DecisionJobTrigger,
  DecisionPlan,
  DuplicateCluster,
  DuplicateOverride,
  DuplicateOverrideRevocation,
  DuplicatePairEvaluation,
  FieldProvenance,
  ListingExtractionRun,
  ListingLifecycleState,
  ListingPhoto,
  ListingScore,
  ListingSourceRecord,
  JobAttempt,
  NormalizationJob,
  RawListing,
  RawListingCapture,
  RiskSignal,
  SearchProfile,
  SourceJob,
  SourceJobStatus,
  SourcePolicyManifest,
  Viewing
} from "@vera/domain";

export interface DecisionCorpusState {
  readonly searchProfileId: string;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface DecisionRunRecord {
  readonly id: string;
  readonly jobId: string;
  readonly searchProfileId: string;
  readonly corpusRevision: number;
  readonly planVersion: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly createdAt: string;
}

export interface EnqueueDecisionJobInput {
  readonly id: string;
  readonly searchProfileId: string;
  readonly trigger: DecisionJobTrigger;
  readonly now: string;
}

export interface ClaimDecisionJobInput {
  readonly leaseOwner: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface FailDecisionJobInput {
  readonly id: string;
  readonly leaseOwner: string;
  readonly retryable: boolean;
  readonly errorCode: DecisionJobErrorCode;
  readonly errorMessage: string;
  readonly failedAt: string;
  readonly retryAt: string;
}

export interface AppliedDecisionRun {
  readonly run: DecisionRunRecord;
  readonly replayed: boolean;
}

export interface RawImportResult {
  readonly record: RawListing;
  readonly inserted: boolean;
}

export class RepositoryNotFoundError extends Error {
  readonly entity: string;
  readonly id: string;

  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found.`);
    this.name = "RepositoryNotFoundError";
    this.entity = entity;
    this.id = id;
  }
}

export class RepositoryJobLeaseError extends Error {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Normalization job ${jobId} is not leased by the requested owner.`);
    this.name = "RepositoryJobLeaseError";
    this.jobId = jobId;
  }
}

export interface SearchProfileRepository {
  insert(profile: SearchProfile): SearchProfile;
  getById(id: string): SearchProfile | null;
  count(): number;
}

export interface RawListingRepository {
  import(capture: RawListingCapture): RawImportResult;
  getById(id: string): RawListing | null;
  count(): number;
}

export interface ListingSourceRecordRepository {
  insert(record: ListingSourceRecord): ListingSourceRecord;
  getById(id: string): ListingSourceRecord | null;
  getByRawListingId(rawListingId: string): ListingSourceRecord | null;
  listByCanonicalListingId(canonicalListingId: string): readonly ListingSourceRecord[];
  count(): number;
}

export interface ListingPhotoRepository {
  insert(photo: ListingPhoto): ListingPhoto;
  getById(id: string): ListingPhoto | null;
}

export interface FieldProvenanceRepository {
  insert(provenance: FieldProvenance): FieldProvenance;
  getById(id: string): FieldProvenance | null;
  listBySourceRecordId(sourceRecordId: string): readonly FieldProvenance[];
  count(): number;
}

export interface ListingExtractionRepository {
  insert(run: ListingExtractionRun): ListingExtractionRun;
  getById(id: string): ListingExtractionRun | null;
  getByRawListingId(rawListingId: string): ListingExtractionRun | null;
  getBySourceRecordId(sourceRecordId: string): ListingExtractionRun | null;
}

export interface DuplicateClusterRepository {
  insert(cluster: DuplicateCluster): DuplicateCluster;
  getById(id: string): DuplicateCluster | null;
  count(): number;
}

export interface CanonicalListingRepository {
  insert(listing: CanonicalListing): CanonicalListing;
  getById(id: string): CanonicalListing | null;
  list(): readonly CanonicalListing[];
  listSummaries(): readonly CanonicalListingSummary[];
  addSource(membership: CanonicalListingSource): CanonicalListingSource;
  setFieldSource(selection: CanonicalFieldSource): CanonicalFieldSource;
  listFieldSources(id: string): readonly CanonicalFieldSource[];
  transitionLifecycle(
    id: string,
    requested: ListingLifecycleState,
    transitionedAt: string
  ): CanonicalListing;
  count(): number;
  sourceMembershipCount(): number;
  fieldSelectionCount(): number;
}

export interface ListingScoreRepository {
  insert(score: ListingScore): ListingScore;
  getById(id: string): ListingScore | null;
  listByCanonicalListingId(id: string): readonly ListingScore[];
  count(): number;
}

export interface RiskSignalRepository {
  insert(signal: RiskSignal): RiskSignal;
  getById(id: string): RiskSignal | null;
  listByCanonicalListingId(id: string): readonly RiskSignal[];
  count(): number;
}

export interface ContactWorkflowRepository {
  insert(workflow: ContactWorkflow): ContactWorkflow;
  getById(id: string): ContactWorkflow | null;
}

export interface ApprovalRepository {
  insert(approval: Approval): Approval;
  getById(id: string): Approval | null;
}

export interface ViewingRepository {
  insert(viewing: Viewing): Viewing;
  getById(id: string): Viewing | null;
}

export interface ActivityEventRepository {
  append(event: ActivityEvent): ActivityEvent;
  getById(id: string): ActivityEvent | null;
  list(): readonly ActivityEvent[];
  listByTarget(targetType: string, targetId: string): readonly ActivityEvent[];
  count(): number;
}

export interface SourcePolicyManifestRepository {
  insert(manifest: SourcePolicyManifest): SourcePolicyManifest;
  get(connectorId: string, version: number): SourcePolicyManifest | null;
  list(): readonly SourcePolicyManifest[];
  listLatest(): readonly SourcePolicyManifest[];
}

export interface SourceJobTransitionPatch {
  readonly attempts?: number;
  readonly manualAction?: SourceJob["manualAction"];
  readonly deferredReason?: SourceJob["deferredReason"];
  readonly result?: SourceJob["result"];
}

export interface SourceJobRepository {
  enqueue(job: SourceJob): { readonly record: SourceJob; readonly inserted: boolean };
  getById(id: string): SourceJob | null;
  getByIdempotencyKey(key: string): SourceJob | null;
  list(): readonly SourceJob[];
  transition(
    id: string,
    requested: SourceJobStatus,
    transitionedAt: string,
    patch?: SourceJobTransitionPatch
  ): SourceJob;
}

export interface SourceJobAttemptRepository {
  append(attempt: JobAttempt): JobAttempt;
  listByJobId(jobId: string): readonly JobAttempt[];
}

export interface BrowserNodeRepository {
  upsert(status: BrowserNodeStatus): BrowserNodeStatus;
  getById(id: string): BrowserNodeStatus | null;
  list(): readonly BrowserNodeStatus[];
}

export interface EnqueueNormalizationJob {
  readonly id: string;
  readonly rawListingId: string;
  readonly idempotencyKey: string;
  readonly availableAt: string;
  readonly maxAttempts: number;
  readonly correlationId: string;
  readonly causationId: string;
  readonly createdAt: string;
}

export interface EnqueueNormalizationJobResult {
  readonly record: NormalizationJob;
  readonly inserted: boolean;
}

export interface ClaimNormalizationJob {
  readonly leaseOwner: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface CompleteNormalizationJob {
  readonly id: string;
  readonly leaseOwner: string;
  readonly completedAt: string;
}

export interface FailNormalizationJob {
  readonly id: string;
  readonly leaseOwner: string;
  readonly retryable: boolean;
  readonly failedAt: string;
  readonly retryAt: string;
  readonly errorCode: string;
  readonly errorCategory: string;
}

export interface NormalizationJobRepository {
  enqueue(input: EnqueueNormalizationJob): EnqueueNormalizationJobResult;
  getById(id: string): NormalizationJob | null;
  getByRawListingId(rawListingId: string): NormalizationJob | null;
  claimNext(input: ClaimNormalizationJob): NormalizationJob | null;
  complete(input: CompleteNormalizationJob): NormalizationJob;
  fail(input: FailNormalizationJob): NormalizationJob;
  count(): number;
}

export interface DecisionJobRepository {
  getCorpusState(searchProfileId: string): DecisionCorpusState | null;
  ensureCorpusState(searchProfileId: string, now: string): DecisionCorpusState;
  bumpCorpusRevisionAndEnqueue(input: EnqueueDecisionJobInput): DecisionJob;
  enqueueCurrentRevision(input: EnqueueDecisionJobInput): DecisionJob;
  getById(id: string): DecisionJob | null;
  getByProfileRevision(searchProfileId: string, revision: number): DecisionJob | null;
  list(): readonly DecisionJob[];
  claimNext(input: ClaimDecisionJobInput): DecisionJob | null;
  appendAttempt(attempt: DecisionJobAttempt): DecisionJobAttempt;
  listAttempts(jobId: string): readonly DecisionJobAttempt[];
  fail(input: FailDecisionJobInput): DecisionJob;
  cancel(id: string, cancelledAt: string): DecisionJob;
}

export interface DuplicateOverrideRepository {
  create(override: DuplicateOverride): DuplicateOverride;
  revoke(revocation: DuplicateOverrideRevocation): DuplicateOverrideRevocation;
  list(searchProfileId: string): readonly DuplicateOverride[];
  listActive(searchProfileId: string): readonly DuplicateOverride[];
  listRevocations(searchProfileId: string): readonly DuplicateOverrideRevocation[];
}

export interface DecisionHistoryRepository {
  getRunById(id: string): DecisionRunRecord | null;
  getRunByJobId(jobId: string): DecisionRunRecord | null;
  listRuns(searchProfileId: string): readonly DecisionRunRecord[];
  listPairEvaluations(decisionRunId: string): readonly DuplicatePairEvaluation[];
}

export interface DecisionReconciliationRepository {
  readSnapshot(input: {
    readonly searchProfileId: string;
    readonly targetCorpusRevision: number;
  }): DecisionCorpusSnapshot;
  applyPlan(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly plan: DecisionPlan;
  }): AppliedDecisionRun;
}

export interface VeraRepositories {
  readonly searchProfiles: SearchProfileRepository;
  readonly rawListings: RawListingRepository;
  readonly sourceRecords: ListingSourceRecordRepository;
  readonly listingPhotos: ListingPhotoRepository;
  readonly fieldProvenance: FieldProvenanceRepository;
  readonly listingExtractions: ListingExtractionRepository;
  readonly duplicateClusters: DuplicateClusterRepository;
  readonly canonicalListings: CanonicalListingRepository;
  readonly listingScores: ListingScoreRepository;
  readonly riskSignals: RiskSignalRepository;
  readonly contactWorkflows: ContactWorkflowRepository;
  readonly approvals: ApprovalRepository;
  readonly viewings: ViewingRepository;
  readonly activityEvents: ActivityEventRepository;
  readonly sourcePolicyManifests: SourcePolicyManifestRepository;
  readonly sourceJobs: SourceJobRepository;
  readonly sourceJobAttempts: SourceJobAttemptRepository;
  readonly browserNodes: BrowserNodeRepository;
  readonly normalizationJobs: NormalizationJobRepository;
  readonly decisionJobs: DecisionJobRepository;
  readonly duplicateOverrides: DuplicateOverrideRepository;
  readonly decisionHistory: DecisionHistoryRepository;
  readonly decisionReconciliation: DecisionReconciliationRepository;
  transaction<T>(callback: (repositories: VeraRepositories) => T): T;
}
