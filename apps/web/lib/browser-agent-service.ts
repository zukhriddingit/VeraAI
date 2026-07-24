import {
  canonicalJson,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import {
  ActivityEventSchema,
  BrowserAgentStatusResponseSchema,
  BrowserControlMutationSchema,
  BrowserIntegrationControlSchema,
  BrowserProfileControlSchema,
  CreateCurrentTabCaptureRequestSchema,
  CreateCurrentTabCaptureResponseSchema,
  requireFounderBrowserAccess,
  SourceJobSchema,
  type BrowserAgentStatusResponse,
  type BrowserControlMutation,
  type CreateCurrentTabCaptureRequest,
  type CreateCurrentTabCaptureResponse,
  type VeraUserId
} from "@vera/domain";
import { canonicalizeZillowListingUrl, evaluateCurrentTabCapturePolicy } from "@vera/policy";

export interface BrowserAgentServiceDependencies {
  readonly repositories: UserRepositories;
  readonly systemBrowserDisabled: boolean;
  now(): Date;
  createId(): string;
}

export interface BrowserAgentCaptureServiceDependencies extends BrowserAgentServiceDependencies {
  readonly repositoryProvider: UserRepositoryProvider;
  readonly userId: VeraUserId;
  readonly founderBrowserUserIds: string | undefined;
}

function nowIso(dependencies: BrowserAgentServiceDependencies): string {
  const value = dependencies.now();
  if (Number.isNaN(value.getTime())) throw new Error("Browser-agent clock is invalid.");
  return value.toISOString();
}

function readiness(
  node: BrowserAgentStatusResponse["node"],
  controls: BrowserAgentStatusResponse["controls"],
  currentJob: BrowserAgentStatusResponse["currentJob"],
  now: Date
): BrowserAgentStatusResponse["readiness"] {
  if (
    controls.systemBrowserDisabled ||
    !controls.userBrowserEnabled ||
    !controls.zillowSourceEnabled ||
    controls.nodeDisabled ||
    controls.profileDisabled
  ) {
    return "disabled_by_policy";
  }
  if (!node) return "not_configured";
  if (currentJob?.status === "manual_action_required") {
    return currentJob.manualAction?.blocker === "login_required"
      ? "manual_login_required"
      : "manual_blocker";
  }
  if (node.pairingState !== "paired") return "pairing_required";
  if (node.capabilityApprovalState !== "approved") return "capability_approval_required";
  if (node.versionCompatibility !== "compatible") return "version_incompatible";
  if (node.status !== "online" || new Date(node.heartbeatExpiresAt).getTime() <= now.getTime()) {
    return "offline";
  }
  return "online_ready";
}

export async function getBrowserAgentStatus(
  dependencies: BrowserAgentServiceDependencies
): Promise<BrowserAgentStatusResponse> {
  const [control, nodes, jobs] = await Promise.all([
    dependencies.repositories.browserIntegrationControls.get(),
    dependencies.repositories.browserNodes.list(),
    dependencies.repositories.sourceJobs.list()
  ]);
  const browserJobs = jobs.filter((job) => job.connectorId === "zillow.current-tab.v1");
  const currentJob = browserJobs.at(-1) ?? null;
  const requestedNodeId =
    currentJob?.payload.acquisitionMode === "local_browser" ? currentJob.payload.nodeId : undefined;
  const node =
    nodes.find((candidate) => candidate.nodeId === requestedNodeId) ?? nodes.at(-1) ?? null;
  const profile =
    node?.selectedProfileId === null || node === null
      ? null
      : await dependencies.repositories.browserProfileControls.get(
          node.nodeId,
          node.selectedProfileId
        );
  const controls = {
    systemBrowserDisabled: dependencies.systemBrowserDisabled,
    userBrowserEnabled: control.userBrowserEnabled,
    zillowSourceEnabled: control.zillowSourceEnabled,
    nodeDisabled: node?.disabledAt !== null && node?.disabledAt !== undefined,
    profileDisabled: node !== null && (profile === null || profile.disabledAt !== null),
    updatedAt: control.updatedAt
  };

  let canonicalListingId: string | null = null;
  const rawListingId = currentJob?.result?.capture?.acceptedRawListingId ?? null;
  if (rawListingId) {
    const sourceRecord =
      await dependencies.repositories.sourceRecords.getByRawListingId(rawListingId);
    if (sourceRecord) {
      for (const listing of await dependencies.repositories.canonicalListings.list()) {
        const members = await dependencies.repositories.sourceRecords.listByCanonicalListingId(
          listing.id
        );
        if (members.some((member) => member.id === sourceRecord.id)) {
          canonicalListingId = listing.id;
          break;
        }
      }
    }
  }

  return BrowserAgentStatusResponseSchema.parse({
    supportStatus: "unsupported_experimental",
    readiness: readiness(node, controls, currentJob, dependencies.now()),
    sourcePolicyState: "experimental_personal",
    node,
    controls,
    currentJob,
    lastSuccessfulCanonicalListingId: canonicalListingId,
    privacyNotice:
      "Marketplace login state stays in your dedicated local profile. Page content required for capture may traverse your configured OpenClaw gateway to hosted Vera."
  });
}

export async function mutateBrowserControls(
  dependencies: BrowserAgentServiceDependencies,
  inputValue: BrowserControlMutation
): Promise<BrowserAgentStatusResponse> {
  const input = BrowserControlMutationSchema.parse(inputValue);
  if (
    dependencies.systemBrowserDisabled &&
    (input.userBrowserEnabled === true ||
      input.zillowSourceEnabled === true ||
      input.nodeEnabled === true ||
      input.profileEnabled === true)
  ) {
    throw new Error(
      "Browser controls cannot be enabled while the system browser kill switch is active."
    );
  }
  const at = nowIso(dependencies);
  const current = await dependencies.repositories.browserIntegrationControls.get();
  if (input.userBrowserEnabled !== undefined || input.zillowSourceEnabled !== undefined) {
    await dependencies.repositories.browserIntegrationControls.upsert(
      BrowserIntegrationControlSchema.parse({
        userBrowserEnabled: input.userBrowserEnabled ?? current.userBrowserEnabled,
        zillowSourceEnabled: input.zillowSourceEnabled ?? current.zillowSourceEnabled,
        updatedAt: at
      })
    );
  }
  if (input.nodeId !== undefined && input.nodeEnabled !== undefined) {
    const node = await dependencies.repositories.browserNodes.getById(input.nodeId);
    if (!node) throw new Error("The selected browser node does not belong to this user.");
    await dependencies.repositories.browserNodes.upsert({
      ...node,
      disabledAt: input.nodeEnabled ? null : at,
      updatedAt: at
    });
  }
  if (
    input.nodeId !== undefined &&
    input.profileId !== undefined &&
    input.profileEnabled !== undefined
  ) {
    const node = await dependencies.repositories.browserNodes.getById(input.nodeId);
    if (!node || !node.allowedProfileIds.includes(input.profileId)) {
      throw new Error("The browser profile is not allowlisted on this user's selected node.");
    }
    await dependencies.repositories.browserProfileControls.upsert(
      BrowserProfileControlSchema.parse({
        nodeId: node.nodeId,
        profileId: input.profileId,
        disabledAt: input.profileEnabled ? null : at,
        updatedAt: at
      })
    );
    if (input.profileEnabled && node.selectedProfileId !== input.profileId) {
      await dependencies.repositories.browserNodes.upsert({
        ...node,
        selectedProfileId: input.profileId,
        updatedAt: at
      });
    }
  }
  return getBrowserAgentStatus(dependencies);
}

export async function createCurrentTabCaptureJob(
  dependencies: BrowserAgentCaptureServiceDependencies,
  inputValue: CreateCurrentTabCaptureRequest
): Promise<CreateCurrentTabCaptureResponse> {
  const input = CreateCurrentTabCaptureRequestSchema.parse(inputValue);
  requireFounderBrowserAccess(dependencies.userId, dependencies.founderBrowserUserIds);
  const at = nowIso(dependencies);
  const canonicalUrl = canonicalizeZillowListingUrl(input.expectedUrl);
  const [control, node, profile] = await Promise.all([
    dependencies.repositories.browserIntegrationControls.get(),
    dependencies.repositories.browserNodes.getById(input.nodeId),
    dependencies.repositories.browserProfileControls.get(input.nodeId, input.profileId)
  ]);
  const policy = evaluateCurrentTabCapturePolicy({
    expectedUrl: input.expectedUrl,
    profileId: input.profileId,
    node,
    controls: {
      systemBrowserDisabled: dependencies.systemBrowserDisabled,
      userBrowserEnabled: control.userBrowserEnabled,
      zillowSourceEnabled: control.zillowSourceEnabled,
      nodeDisabled: node?.disabledAt !== null && node?.disabledAt !== undefined,
      profileDisabled: profile === null || profile.disabledAt !== null
    },
    hasUserSession: true,
    hasApproval: true
  });
  if (!policy.allowed) throw new Error(`Browser capture denied by policy: ${policy.reason}.`);

  const payload = {
    acquisitionMode: "local_browser" as const,
    captureKind: "current_tab" as const,
    nodeId: input.nodeId,
    profileId: input.profileId,
    expectedUrl: input.expectedUrl,
    canonicalUrl,
    limits: {
      maxPages: 1 as const,
      maxRecords: 1 as const,
      maxBytes: 250_000,
      maxDurationMilliseconds: 30_000,
      maxConcurrency: 1 as const
    }
  };
  const payloadHash = sha256Text(canonicalJson(payload));
  const idempotencyKey = sha256Text(
    `browser-capture-request:v1:${input.nodeId}:${input.profileId}:${canonicalUrl}:${input.requestIdempotencyKey}`
  );
  const existing = await dependencies.repositories.sourceJobs.getByIdempotencyKey(idempotencyKey);
  if (existing)
    return CreateCurrentTabCaptureResponseSchema.parse({ job: existing, inserted: false });

  const jobId = `source-job-${idempotencyKey.slice(0, 32)}`;
  const approvalId = `approval-browser-${idempotencyKey.slice(0, 32)}`;
  const job = SourceJobSchema.parse({
    id: jobId,
    correlationId: dependencies.createId(),
    connectorId: "zillow.current-tab.v1",
    source: "zillow",
    acquisitionMode: "local_browser",
    manifestVersion: 1,
    trigger: "manual",
    capability: "browser.capture",
    approvalId,
    operation: "capture.current_tab",
    payload,
    payloadHash,
    idempotencyKey,
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    manualAction: null,
    deferredReason: null,
    result: null,
    createdAt: at,
    updatedAt: at,
    completedAt: null
  });
  return dependencies.repositoryProvider.transaction(dependencies.userId, async (repositories) => {
    const replay = await repositories.sourceJobs.getByIdempotencyKey(idempotencyKey);
    if (replay) {
      return CreateCurrentTabCaptureResponseSchema.parse({ job: replay, inserted: false });
    }
    await repositories.approvals.insert({
      id: approvalId,
      actor: "user",
      connectorId: "zillow.current-tab.v1",
      operation: "capture.current_tab",
      targetType: "source_job",
      targetId: jobId,
      payloadHash,
      state: "used",
      createdAt: at,
      expiresAt: new Date(dependencies.now().getTime() + 5 * 60_000).toISOString(),
      usedAt: at
    });
    const enqueued = await repositories.sourceJobs.enqueue(job);
    for (const [index, action] of ["browser.job_created", "browser.policy_approved"].entries()) {
      await repositories.activityEvents.append(
        ActivityEventSchema.parse({
          id: `activity-browser-create-${index + 1}-${idempotencyKey.slice(0, 24)}`,
          correlationId: job.correlationId,
          causationId: job.id,
          actor: index === 0 ? "user" : "system",
          action,
          targetType: "source_job",
          targetId: job.id,
          policyDecision: "authorized",
          approvalId,
          payloadHash,
          outcome: index === 0 ? "recorded" : "authorized",
          errorCategory: null,
          metadata: {
            connectorId: job.connectorId,
            supportStatus: "unsupported_experimental",
            captureKind: "current_tab"
          },
          occurredAt: at
        })
      );
    }
    return CreateCurrentTabCaptureResponseSchema.parse(enqueued);
  });
}
