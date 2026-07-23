import type {
  ActivityEvent,
  Approval,
  ApprovalState,
  AvailabilityCheck,
  AvailabilityRuleSet,
  BrowserCaptureAcceptance,
  BrowserIntegrationControl,
  BrowserProfileControl,
  BrowserNodeStatus,
  CanonicalFieldSource,
  CanonicalListing,
  CanonicalListingSource,
  CanonicalListingSummary,
  CalendarHold,
  CalendarHoldState,
  CalendarOAuthState,
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
  IntegrationConnection,
  IntegrationProvider,
  GmailAlertCursor,
  GmailAlertExternalReferenceRecord,
  GmailOAuthState,
  ListingExtractionRun,
  ListingLifecycleState,
  ListingPhoto,
  ListingScore,
  ListingScoreV2,
  ListingSourceRecord,
  MaritimeDeployment,
  MaritimeDispatch,
  MaritimeDispatchState,
  NotificationDelivery,
  NotificationDeliveryState,
  NotificationPreference,
  JobAttempt,
  NormalizationJob,
  RawListing,
  RawListingCapture,
  RiskSignal,
  RiskSignalV2,
  SearchProfile,
  ServiceHeartbeat,
  SourceJob,
  SourceJobStatus,
  SourcePolicyManifest,
  ProductionSchedule,
  ProductionScheduleRun,
  ProductionScheduleRunState,
  ProposedViewingWindow,
  VeraUserId,
  Viewing,
  ViewingState,
  ViewingWindow,
  WebPushSubscriptionRecord,
  WebPushSubscriptionStatus
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

export class StaleCorpusRevisionError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super("Decision plan was computed from a stale corpus revision.");
    this.name = "StaleCorpusRevisionError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class DecisionIdempotencyConflictError extends Error {
  constructor() {
    super("Decision job already has a different immutable result.");
    this.name = "DecisionIdempotencyConflictError";
  }
}

export interface SearchProfileRepository {
  insert(profile: SearchProfile): SearchProfile;
  getById(id: string): SearchProfile | null;
  list(): readonly SearchProfile[];
  count(): number;
}

export interface IntegrationConnectionRepository {
  upsert(connection: IntegrationConnection): IntegrationConnection;
  getById(id: string): IntegrationConnection | null;
  getByProviderSubjectId(
    provider: IntegrationProvider,
    providerSubjectId: string
  ): IntegrationConnection | null;
  list(): readonly IntegrationConnection[];
  delete(id: string): boolean;
}

export interface IntegrationRefreshLeaseInput {
  readonly integrationId: string;
  readonly leaseOwner: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface IntegrationRefreshLeaseReleaseInput {
  readonly integrationId: string;
  readonly leaseOwner: string;
}

export interface IntegrationRefreshLeaseRepository {
  tryAcquire(input: IntegrationRefreshLeaseInput): boolean;
  release(input: IntegrationRefreshLeaseReleaseInput): boolean;
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
  getCurrentV2ByCanonicalListingId(id: string, decisionRunId: string): ListingScoreV2 | null;
  count(): number;
}

export interface RiskSignalRepository {
  insert(signal: RiskSignal): RiskSignal;
  getById(id: string): RiskSignal | null;
  listByCanonicalListingId(id: string): readonly RiskSignal[];
  listCurrentV2ByCanonicalListingId(id: string, decisionRunId: string): readonly RiskSignalV2[];
  count(): number;
}

export interface ContactWorkflowRepository {
  insert(workflow: ContactWorkflow): ContactWorkflow;
  getById(id: string): ContactWorkflow | null;
}

export interface ApprovalRepository {
  insert(approval: Approval): Approval;
  getById(id: string): Approval | null;
  transition(id: string, expected: ApprovalState, requested: ApprovalState, at: string): Approval;
}

export interface ViewingTransitionPatch {
  readonly selectedWindow?: ProposedViewingWindow | null;
  readonly confirmedWindow?: ViewingWindow | null;
  readonly calendarReference?: string | null;
  readonly supersedesViewingId?: string | null;
}

export interface ViewingRepository {
  insert(viewing: Viewing): Viewing;
  getById(id: string): Viewing | null;
  prepareCalendarHold(
    id: string,
    expectedState: "selected" | "hold_approved",
    contactNotes: string | null,
    remindersMinutesBeforeStart: readonly number[],
    at: string
  ): Viewing;
  transition(
    id: string,
    expected: ViewingState,
    requested: ViewingState,
    at: string,
    patch?: ViewingTransitionPatch
  ): Viewing;
  listByCanonicalListingId(id: string): readonly Viewing[];
}

export interface AvailabilityRuleSetRepository {
  upsertCurrent(value: AvailabilityRuleSet): AvailabilityRuleSet;
  getCurrent(): AvailabilityRuleSet | null;
}

export interface CalendarOAuthStateRepository {
  insert(value: CalendarOAuthState): CalendarOAuthState;
  consume(input: { readonly stateHash: string; readonly consumedAt: string }): CalendarOAuthState;
}

export interface AvailabilityCheckRepository {
  append(value: AvailabilityCheck): AvailabilityCheck;
  getById(id: string): AvailabilityCheck | null;
  listRecent(limit: number): readonly AvailabilityCheck[];
}

export interface CalendarHoldTransitionPatch {
  readonly approvalId?: string | null;
  readonly providerEventReference?: string | null;
  readonly availabilityCheckId?: string | null;
  readonly safeErrorCode?: string | null;
  readonly completedAt?: string | null;
}

export interface CalendarHoldRepository {
  insert(value: CalendarHold): CalendarHold;
  getById(id: string): CalendarHold | null;
  getByIdempotencyKey(key: string): CalendarHold | null;
  listByViewingId(viewingId: string): readonly CalendarHold[];
  transition(
    id: string,
    expected: CalendarHoldState,
    requested: CalendarHoldState,
    at: string,
    patch?: CalendarHoldTransitionPatch
  ): CalendarHold;
}

export interface BeginCalendarHoldCreationInput {
  readonly holdId: string;
  readonly viewingId: string;
  readonly approvalId: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly selectedWindow: ProposedViewingWindow;
  readonly availabilityCheckId?: string;
  readonly requestedAt: string;
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

export interface MaritimeDispatchTransitionPatch {
  readonly maritimeRunId?: string | null;
  readonly rejectionCode?: string | null;
}

export interface MaritimeDispatchRepository {
  create(dispatch: MaritimeDispatch): MaritimeDispatch;
  getById(id: string): MaritimeDispatch | null;
  getBySourceJobId(sourceJobId: string): MaritimeDispatch | null;
  getByNonceHash(nonceHash: string): MaritimeDispatch | null;
  list(): readonly MaritimeDispatch[];
  transition(
    id: string,
    expected: MaritimeDispatchState,
    requested: MaritimeDispatchState,
    at: string,
    patch?: MaritimeDispatchTransitionPatch
  ): MaritimeDispatch;
}

export interface ProductionScheduleRepository {
  upsert(schedule: ProductionSchedule): ProductionSchedule;
  getById(id: string): ProductionSchedule | null;
  list(): readonly ProductionSchedule[];
  listDue(now: string, limit: number): readonly ProductionSchedule[];
  createRun(run: ProductionScheduleRun): {
    readonly record: ProductionScheduleRun;
    readonly inserted: boolean;
  };
  getRunById(id: string): ProductionScheduleRun | null;
  getRunByIdempotencyKey(key: string): ProductionScheduleRun | null;
  listRuns(scheduleId: string): readonly ProductionScheduleRun[];
  transitionRun(
    id: string,
    expected: ProductionScheduleRunState,
    requested: ProductionScheduleRunState,
    at: string,
    safeErrorCode?: string | null
  ): ProductionScheduleRun;
}

export interface NotificationPreferenceRepository {
  get(): NotificationPreference | null;
  upsert(preference: NotificationPreference): NotificationPreference;
}

export interface WebPushSubscriptionRepository {
  insert(subscription: WebPushSubscriptionRecord): WebPushSubscriptionRecord;
  getById(id: string): WebPushSubscriptionRecord | null;
  getByEndpointHash(endpointHash: string): WebPushSubscriptionRecord | null;
  list(): readonly WebPushSubscriptionRecord[];
  transition(
    id: string,
    expected: WebPushSubscriptionStatus,
    requested: WebPushSubscriptionStatus,
    at: string
  ): WebPushSubscriptionRecord;
}

export interface NotificationDeliveryRepository {
  enqueue(delivery: NotificationDelivery): {
    readonly record: NotificationDelivery;
    readonly inserted: boolean;
  };
  getById(id: string): NotificationDelivery | null;
  getByIdempotencyKey(key: string): NotificationDelivery | null;
  list(): readonly NotificationDelivery[];
  transition(
    id: string,
    expected: NotificationDeliveryState,
    requested: NotificationDeliveryState,
    at: string,
    safeErrorCode?: string | null,
    availableAt?: string
  ): NotificationDelivery;
}

export interface GmailOAuthStateRepository {
  insert(state: GmailOAuthState): GmailOAuthState;
  consume(stateHash: string, consumedAt: string): GmailOAuthState;
}

export interface GmailAlertCursorRepository {
  getBySourceConfigurationId(sourceConfigurationId: string): GmailAlertCursor | null;
  upsert(cursor: GmailAlertCursor): GmailAlertCursor;
}

export interface GmailAlertExternalReferenceRepository {
  insert(reference: GmailAlertExternalReferenceRecord): GmailAlertExternalReferenceRecord;
  getByMessageId(messageId: string): GmailAlertExternalReferenceRecord | null;
}

export interface MaritimeOperationsRepository {
  upsertDeployment(deployment: MaritimeDeployment): Promise<MaritimeDeployment>;
  listDeployments(): Promise<readonly MaritimeDeployment[]>;
  upsertHeartbeat(heartbeat: ServiceHeartbeat): Promise<ServiceHeartbeat>;
  listHeartbeats(): Promise<readonly ServiceHeartbeat[]>;
}

export interface BrowserIntegrationControlRepository {
  get(): BrowserIntegrationControl;
  upsert(control: BrowserIntegrationControl): BrowserIntegrationControl;
}

export interface BrowserProfileControlRepository {
  get(nodeId: string, profileId: string): BrowserProfileControl | null;
  upsert(control: BrowserProfileControl): BrowserProfileControl;
}

export interface BrowserCaptureAcceptanceRepository {
  insert(acceptance: BrowserCaptureAcceptance): BrowserCaptureAcceptance;
  getById(id: string): BrowserCaptureAcceptance | null;
  getBySourceJobId(sourceJobId: string): BrowserCaptureAcceptance | null;
  getByInvocationIdempotencyKey(key: string): BrowserCaptureAcceptance | null;
}

export interface AcceptBrowserCaptureInput {
  readonly sourceJobId: string;
  readonly attemptId: string;
  readonly nodeId: string;
  readonly profileId: string;
  readonly payloadHash: string;
  readonly invocationIdempotencyKey: string;
  readonly resultHash: string;
  readonly contentHash: string;
  readonly canonicalUrl: string;
  readonly pageTitle: string;
  readonly renderedText: string;
  readonly structuredMetadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly observedAt: string;
  readonly acceptedAt: string;
}

export interface AcceptBrowserCaptureResult {
  readonly acceptance: BrowserCaptureAcceptance;
  readonly rawListing: RawListing;
  readonly replayed: boolean;
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

export interface SyncVeraRepositories {
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
  transaction<T>(callback: (repositories: SyncVeraRepositories) => T): T;
}

/**
 * Temporary compatibility name for the isolated SQLite adapter. Hosted code must use
 * UserRepositories through UserRepositoryProvider. This alias is removed when the demo move lands.
 */
export type VeraRepositories = SyncVeraRepositories;

type AsyncMethod<Method> = Method extends (...arguments_: infer Arguments) => infer Result
  ? (...arguments_: Arguments) => Promise<Awaited<Result>>
  : never;

export type AsyncRepository<Repository> = {
  readonly [Key in keyof Repository]: AsyncMethod<Repository[Key]>;
};

export type SourcePolicyManifestReader = AsyncRepository<
  Pick<SourcePolicyManifestRepository, "get" | "list" | "listLatest">
>;

export interface UserRepositories {
  readonly integrationConnections: AsyncRepository<IntegrationConnectionRepository>;
  readonly integrationRefreshLeases: AsyncRepository<IntegrationRefreshLeaseRepository>;
  readonly searchProfiles: AsyncRepository<SearchProfileRepository>;
  readonly rawListings: AsyncRepository<RawListingRepository>;
  readonly sourceRecords: AsyncRepository<ListingSourceRecordRepository>;
  readonly listingPhotos: AsyncRepository<ListingPhotoRepository>;
  readonly fieldProvenance: AsyncRepository<FieldProvenanceRepository>;
  readonly listingExtractions: AsyncRepository<ListingExtractionRepository>;
  readonly duplicateClusters: AsyncRepository<DuplicateClusterRepository>;
  readonly canonicalListings: AsyncRepository<CanonicalListingRepository>;
  readonly listingScores: AsyncRepository<ListingScoreRepository>;
  readonly riskSignals: AsyncRepository<RiskSignalRepository>;
  readonly contactWorkflows: AsyncRepository<ContactWorkflowRepository>;
  readonly approvals: AsyncRepository<ApprovalRepository>;
  readonly viewings: AsyncRepository<ViewingRepository>;
  readonly availabilityRuleSets: AsyncRepository<AvailabilityRuleSetRepository>;
  readonly calendarOAuthStates: AsyncRepository<CalendarOAuthStateRepository>;
  readonly availabilityChecks: AsyncRepository<AvailabilityCheckRepository>;
  readonly calendarHolds: AsyncRepository<CalendarHoldRepository>;
  readonly activityEvents: AsyncRepository<ActivityEventRepository>;
  readonly sourcePolicyManifests: SourcePolicyManifestReader;
  readonly sourceJobs: AsyncRepository<SourceJobRepository>;
  readonly sourceJobAttempts: AsyncRepository<SourceJobAttemptRepository>;
  readonly browserNodes: AsyncRepository<BrowserNodeRepository>;
  readonly maritimeDispatches: AsyncRepository<MaritimeDispatchRepository>;
  readonly productionSchedules: AsyncRepository<ProductionScheduleRepository>;
  readonly notificationPreferences: AsyncRepository<NotificationPreferenceRepository>;
  readonly webPushSubscriptions: AsyncRepository<WebPushSubscriptionRepository>;
  readonly notificationDeliveries: AsyncRepository<NotificationDeliveryRepository>;
  readonly gmailOAuthStates: AsyncRepository<GmailOAuthStateRepository>;
  readonly gmailAlertCursors: AsyncRepository<GmailAlertCursorRepository>;
  readonly gmailAlertExternalReferences: AsyncRepository<GmailAlertExternalReferenceRepository>;
  readonly browserIntegrationControls: AsyncRepository<BrowserIntegrationControlRepository>;
  readonly browserProfileControls: AsyncRepository<BrowserProfileControlRepository>;
  readonly browserCaptureAcceptances: AsyncRepository<BrowserCaptureAcceptanceRepository>;
  readonly normalizationJobs: AsyncRepository<NormalizationJobRepository>;
  readonly decisionJobs: AsyncRepository<DecisionJobRepository>;
  readonly duplicateOverrides: AsyncRepository<DuplicateOverrideRepository>;
  readonly decisionHistory: AsyncRepository<DecisionHistoryRepository>;
  readonly decisionReconciliation: AsyncRepository<DecisionReconciliationRepository>;
}

export interface UserRepositoryProvider {
  forUser(userId: VeraUserId): UserRepositories;
  transaction<T>(
    userId: VeraUserId,
    operation: (repositories: UserRepositories) => Promise<T>
  ): Promise<T>;
}

export interface OwnedNormalizationJob {
  readonly userId: VeraUserId;
  readonly job: NormalizationJob;
}

export interface OwnedDecisionJob {
  readonly userId: VeraUserId;
  readonly job: DecisionJob;
}

export interface OwnedSourceJob {
  readonly userId: VeraUserId;
  readonly job: SourceJob;
}

export interface OwnedMaritimeDispatch {
  readonly userId: VeraUserId;
  readonly dispatch: MaritimeDispatch;
}

export interface OwnedNotificationDelivery {
  readonly userId: VeraUserId;
  readonly delivery: NotificationDelivery;
}

export interface OwnedProductionSchedule {
  readonly userId: VeraUserId;
  readonly schedule: ProductionSchedule;
}

export interface ClaimSourceJobInput {
  readonly leaseOwner: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface SystemWorkerQueue {
  claimNextNormalizationJob(input: ClaimNormalizationJob): Promise<OwnedNormalizationJob | null>;
  claimNextDecisionJob(input: ClaimDecisionJobInput): Promise<OwnedDecisionJob | null>;
  claimNextSourceJob(input: ClaimSourceJobInput): Promise<OwnedSourceJob | null>;
  claimNextDispatchedSourceJob(
    input: ClaimSourceJobInput & { readonly audience: string }
  ): Promise<OwnedSourceJob | null>;
  claimNextMaritimeDispatch(input: ClaimSourceJobInput): Promise<OwnedMaritimeDispatch | null>;
  claimNextNotificationDelivery(
    input: ClaimSourceJobInput
  ): Promise<OwnedNotificationDelivery | null>;
  claimNextProductionSchedule(
    input: Pick<ClaimSourceJobInput, "now">
  ): Promise<OwnedProductionSchedule | null>;
}

export interface EphemeralCleanupResult {
  readonly gmailOauthStatesDeleted: number;
  readonly dispatchesExpired: number;
  readonly heartbeatsDeleted: number;
  readonly scheduleRunsDeleted: number;
}

export interface SystemEphemeralCleanupRepository {
  cleanup(input: {
    readonly now: string;
    readonly batchSize: number;
  }): Promise<EphemeralCleanupResult>;
}

export type GlobalPolicyRepository = AsyncRepository<SourcePolicyManifestRepository>;
