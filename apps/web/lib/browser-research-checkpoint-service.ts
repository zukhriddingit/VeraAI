import { timingSafeEqual } from "node:crypto";

import {
  ActivityEventSchema,
  BrowserResearchCheckpointRequestSchema,
  type BrowserGatewayRuntime,
  type BrowserResearchCheckpointRequest,
  type BrowserResearchCheckpointResponse,
  type BrowserResearchSource,
  type SourceJob,
  type VeraUserId
} from "@vera/domain";
import {
  signBrowserResearchPlan,
  BROWSER_SOURCE_CONNECTOR_IDS,
  BROWSER_SOURCE_OPERATIONS
} from "@vera/connectors";
import { sha256Text, type UserRepositories } from "@vera/db";
import { evaluateBrowserResearchAction } from "@vera/policy";

import { parseHostedRuntimePolicy } from "./server/hosted-runtime-policy.ts";

export interface BrowserResearchCheckpointEnvironment {
  readonly assignmentAuthorized: boolean;
  readonly enabledSources: ReadonlySet<BrowserResearchSource>;
  readonly browserDisabled: boolean;
  readonly planSigningKey: string;
}

export interface BrowserResearchCheckpointDependencies {
  readonly userId: VeraUserId;
  readonly environment: BrowserResearchCheckpointEnvironment;
  readonly repositories: {
    readonly sourceJobs: Pick<UserRepositories["sourceJobs"], "getById">;
    readonly activityEvents: Pick<UserRepositories["activityEvents"], "append">;
  };
  createId(): string;
  now(): string;
}

export function parseBrowserResearchCheckpointEnvironment(
  userId: VeraUserId,
  browserRuntime: BrowserGatewayRuntime | null,
  environment: Readonly<Record<string, string | undefined>>
): BrowserResearchCheckpointEnvironment {
  const authorizedRuntime = browserRuntime?.assignment.userId === userId ? browserRuntime : null;
  return {
    assignmentAuthorized: authorizedRuntime !== null,
    enabledSources: authorizedRuntime?.enabledSources ?? new Set<BrowserResearchSource>(),
    browserDisabled: parseHostedRuntimePolicy(environment).browserDisabled,
    planSigningKey: authorizedRuntime?.planSigningKey ?? ""
  };
}

export function createBrowserResearchCheckpointDependencies(
  userId: VeraUserId,
  repositories: BrowserResearchCheckpointDependencies["repositories"],
  browserRuntime: BrowserGatewayRuntime | null,
  environment: Readonly<Record<string, string | undefined>> = process.env
): BrowserResearchCheckpointDependencies {
  return {
    userId,
    repositories,
    environment: parseBrowserResearchCheckpointEnvironment(userId, browserRuntime, environment),
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString()
  };
}

function isBrowserResearchJob(
  job: SourceJob | null,
  source: BrowserResearchSource
): job is SourceJob {
  return (
    job !== null &&
    job.connectorId === BROWSER_SOURCE_CONNECTOR_IDS[source] &&
    job.source === source &&
    job.acquisitionMode === "local_browser" &&
    job.operation === BROWSER_SOURCE_OPERATIONS[source] &&
    job.payload.acquisitionMode === "local_browser" &&
    (job.payload.captureKind === "research_tab" || job.payload.captureKind === "detail_enrichment")
  );
}

function signatureValid(request: BrowserResearchCheckpointRequest, signingKey: string): boolean {
  if (signingKey.length < 32) return false;
  try {
    const { signature, ...payload } = request.plan;
    const expected = signBrowserResearchPlan(payload, signingKey).signature;
    const suppliedBytes = Buffer.from(signature, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    return (
      suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
    );
  } catch {
    return false;
  }
}

export async function checkBrowserResearchAction(
  dependencies: BrowserResearchCheckpointDependencies,
  input: unknown
): Promise<BrowserResearchCheckpointResponse> {
  const request = BrowserResearchCheckpointRequestSchema.parse(input);
  const job = await dependencies.repositories.sourceJobs.getById(request.plan.veraRunId);
  const researchJob = isBrowserResearchJob(job, request.plan.source) ? job : null;
  const checkedAt = dependencies.now();
  const response = evaluateBrowserResearchAction({
    checkpoint: request,
    runtime: {
      assignmentAuthorized: dependencies.environment.assignmentAuthorized,
      sourceEnabled: dependencies.environment.enabledSources.has(request.plan.source),
      userTriggered: researchJob?.trigger === "manual",
      browserKillSwitchActive: dependencies.environment.browserDisabled,
      runActive: researchJob?.status === "running",
      cancelled: researchJob?.status === "cancelled_by_policy",
      hasUserSession: researchJob !== null,
      hasApproval: researchJob?.approvalId !== null && researchJob?.approvalId !== undefined,
      planSignatureValid: signatureValid(request, dependencies.environment.planSigningKey)
    },
    checkedAt
  });

  await dependencies.repositories.activityEvents.append(
    ActivityEventSchema.parse({
      id: dependencies.createId(),
      correlationId: researchJob?.correlationId ?? request.plan.veraRunId,
      causationId: researchJob?.id ?? null,
      actor: "connector",
      action: "browser.research_action_checked",
      targetType: "source_job",
      targetId: request.plan.veraRunId,
      policyDecision: response.allowed ? "authorized" : "denied",
      approvalId: researchJob?.approvalId ?? null,
      payloadHash: sha256Text(
        JSON.stringify({
          protocol: "vera-browser-research-checkpoint.v1",
          runId: request.plan.veraRunId,
          source: request.plan.source,
          action: request.action,
          hostname: request.hostname,
          sharedTabCount: request.sharedTabCount,
          elapsedMilliseconds: request.elapsedMilliseconds,
          resultCardsObserved: request.resultCardsObserved,
          detailPagesOpened: request.detailPagesOpened,
          actionsUsed: request.actionsUsed
        })
      ),
      outcome: response.allowed ? "authorized" : "denied",
      errorCategory: null,
      metadata: {
        protocol: "vera-browser-research-checkpoint.v1",
        source: request.plan.source,
        action: request.action,
        hostname: request.hostname,
        allowed: response.allowed,
        reason: response.reason,
        planHash: sha256Text(JSON.stringify(request.plan)),
        approvedTabHash: sha256Text(request.plan.startingTabReference.value),
        activeTabHash: sha256Text(request.activeTabReference.value),
        sharedTabCount: request.sharedTabCount,
        elapsedMilliseconds: request.elapsedMilliseconds,
        resultCardsObserved: request.resultCardsObserved,
        detailPagesOpened: request.detailPagesOpened,
        actionsUsed: request.actionsUsed
      },
      occurredAt: checkedAt
    })
  );

  return response;
}
