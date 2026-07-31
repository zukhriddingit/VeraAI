import {
  ActivityEventSchema,
  VeraUserIdSchema,
  ZillowResearchCheckpointRequestSchema,
  type SourceJob,
  type VeraUserId,
  type ZillowResearchCheckpointRequest,
  type ZillowResearchCheckpointResponse
} from "@vera/domain";
import { sha256Text, type UserRepositories } from "@vera/db";
import { evaluateZillowResearchAction } from "@vera/policy";

import { parseHostedRuntimePolicy } from "./server/hosted-runtime-policy.ts";

const ZILLOW_RESEARCH_CONNECTOR_ID = "zillow.browser-research.v1";
const ZILLOW_RESEARCH_OPERATION = "zillow.rental_research.v1";

export interface ZillowResearchCheckpointEnvironment {
  readonly founderUserId: VeraUserId | null;
  readonly sourceEnabled: boolean;
  readonly browserDisabled: boolean;
}

export interface ZillowResearchCheckpointDependencies {
  readonly userId: VeraUserId;
  readonly environment: ZillowResearchCheckpointEnvironment;
  readonly repositories: {
    readonly sourceJobs: Pick<UserRepositories["sourceJobs"], "getById">;
    readonly activityEvents: Pick<UserRepositories["activityEvents"], "append" | "listByTarget">;
  };
  createId(): string;
  now(): string;
}

export function parseZillowResearchCheckpointEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): ZillowResearchCheckpointEnvironment {
  const founder = environment.VERA_BROWSER_GATEWAY_FOUNDER_USER_ID?.trim();
  const parsedFounder = founder ? VeraUserIdSchema.safeParse(founder) : null;
  if (parsedFounder && !parsedFounder.success) {
    throw new Error("VERA_BROWSER_GATEWAY_FOUNDER_USER_ID must be one exact Vera user UUID.");
  }
  return {
    founderUserId: parsedFounder?.success ? parsedFounder.data : null,
    sourceEnabled: environment.VERA_ZILLOW_BROWSER_RESEARCH_ENABLED === "1",
    browserDisabled: parseHostedRuntimePolicy(environment).browserDisabled
  };
}

export function createZillowResearchCheckpointDependencies(
  userId: VeraUserId,
  repositories: ZillowResearchCheckpointDependencies["repositories"],
  environment: Readonly<Record<string, string | undefined>> = process.env
): ZillowResearchCheckpointDependencies {
  return {
    userId,
    repositories,
    environment: parseZillowResearchCheckpointEnvironment(environment),
    createId: crypto.randomUUID,
    now: () => new Date().toISOString()
  };
}

function isZillowResearchJob(job: SourceJob | null): job is SourceJob & {
  readonly payload: Extract<SourceJob["payload"], { captureKind: "research_tab" }>;
} {
  return (
    job !== null &&
    job.connectorId === ZILLOW_RESEARCH_CONNECTOR_ID &&
    job.source === "zillow" &&
    job.acquisitionMode === "local_browser" &&
    job.operation === ZILLOW_RESEARCH_OPERATION &&
    job.payload.acquisitionMode === "local_browser" &&
    job.payload.captureKind === "research_tab"
  );
}

export async function checkZillowResearchAction(
  dependencies: ZillowResearchCheckpointDependencies,
  input: unknown
): Promise<ZillowResearchCheckpointResponse> {
  const request = ZillowResearchCheckpointRequestSchema.parse(input);
  const job = await dependencies.repositories.sourceJobs.getById(request.veraRunId);
  const researchJob = isZillowResearchJob(job) ? job : null;
  const approvedStartingTab =
    researchJob?.payload.startingTabReference ?? request.startingTabReference;
  const checkedAt = dependencies.now();
  const priorChecks = await dependencies.repositories.activityEvents.listByTarget(
    "source_job",
    request.veraRunId
  );
  const activeTabHash = sha256Text(request.activeTabReference.value);
  const boundTabHash = priorChecks.find(
    (event) =>
      event.action === "browser.zillow_research_action_checked" &&
      typeof event.metadata.tabBindingHash === "string"
  )?.metadata.tabBindingHash;
  const usesConsentReference = approvedStartingTab.kind === "single_shared_tab";
  const activeReferenceCanBind =
    usesConsentReference &&
    request.activeTabReference.kind === "target_id" &&
    (boundTabHash === undefined || boundTabHash === activeTabHash);
  const effectiveActiveTab =
    usesConsentReference &&
    (request.activeTabReference.kind === "single_shared_tab" || activeReferenceCanBind)
      ? approvedStartingTab
      : request.activeTabReference;
  const evaluatedRequest: ZillowResearchCheckpointRequest = {
    ...request,
    startingTabReference: approvedStartingTab,
    activeTabReference: effectiveActiveTab
  };
  const response = evaluateZillowResearchAction({
    checkpoint: evaluatedRequest,
    runtime: {
      founderAuthorized:
        dependencies.environment.founderUserId !== null &&
        dependencies.environment.founderUserId === dependencies.userId,
      sourceEnabled: dependencies.environment.sourceEnabled,
      userTriggered: researchJob?.trigger === "manual",
      browserKillSwitchActive: dependencies.environment.browserDisabled,
      runActive: researchJob?.status === "running",
      cancelled: researchJob?.status === "cancelled_by_policy",
      hasUserSession: researchJob !== null,
      hasApproval: researchJob?.approvalId !== null && researchJob?.approvalId !== undefined
    },
    checkedAt
  });

  await dependencies.repositories.activityEvents.append(
    ActivityEventSchema.parse({
      id: dependencies.createId(),
      correlationId: researchJob?.correlationId ?? request.veraRunId,
      causationId: researchJob?.id ?? null,
      actor: "connector",
      action: "browser.zillow_research_action_checked",
      targetType: "source_job",
      targetId: request.veraRunId,
      policyDecision: response.allowed ? "authorized" : "denied",
      approvalId: researchJob?.approvalId ?? null,
      payloadHash: sha256Text(
        JSON.stringify({
          protocol: "vera-zillow-research-checkpoint.v1",
          veraRunId: request.veraRunId,
          action: request.action,
          hostname: request.hostname,
          approvedTabHash: sha256Text(approvedStartingTab.value),
          activeTabHash,
          observedReferenceHash: request.observedReferenceHash,
          elapsedMilliseconds: request.elapsedMilliseconds,
          resultCardsObserved: request.resultCardsObserved,
          detailPagesOpened: request.detailPagesOpened,
          resultPageExpansions: request.resultPageExpansions
        })
      ),
      outcome: response.allowed ? "authorized" : "denied",
      errorCategory: null,
      metadata: {
        protocol: "vera-zillow-research-checkpoint.v1",
        action: request.action,
        hostname: request.hostname,
        allowed: response.allowed,
        reason: response.reason,
        approvedTabHash: sha256Text(approvedStartingTab.value),
        activeTabHash,
        ...(activeReferenceCanBind ? { tabBindingHash: activeTabHash } : {}),
        ...(request.observedReferenceHash === null
          ? {}
          : { observedReferenceHash: request.observedReferenceHash }),
        sharedTabCount: request.sharedTabCount,
        elapsedMilliseconds: request.elapsedMilliseconds,
        resultCardsObserved: request.resultCardsObserved,
        detailPagesOpened: request.detailPagesOpened,
        resultPageExpansions: request.resultPageExpansions
      },
      occurredAt: checkedAt
    })
  );

  return response;
}
