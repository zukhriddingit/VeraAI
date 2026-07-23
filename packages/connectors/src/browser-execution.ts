import {
  BrowserCaptureLimitsSchema,
  BrowserNodeStatusSchema,
  BrowserProfileIdSchema,
  ConnectorCursorSchema,
  DeferredJobReasonSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  ManualActionBlockerSchema,
  SafeBrowserUrlSchema,
  Sha256Schema,
  SourceJobSafeErrorSchema,
  isBrowserNodeStale,
  type BrowserCaptureLimits,
  type BrowserNodeStatus,
  type ConnectorCursor,
  type DeferredJobReason,
  type SourceJobSafeError
} from "@vera/domain";
import { z } from "zod";

export const BrowserExecutionOperationSchema = z.enum(["navigate", "capture"]);

export const BrowserHeartbeatRequestSchema = z
  .object({
    nodeId: EntityIdSchema,
    correlationId: EntityIdSchema,
    observedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserHeartbeatResultSchema = z
  .object({
    correlationId: EntityIdSchema,
    node: BrowserNodeStatusSchema,
    untrustedInput: z.literal(true)
  })
  .strict();

const BrowserExecutionRequestShape = {
  nodeId: EntityIdSchema,
  executionId: EntityIdSchema,
  correlationId: EntityIdSchema,
  targetUrl: SafeBrowserUrlSchema,
  allowedUrls: z.array(SafeBrowserUrlSchema).min(1).max(201),
  limits: BrowserCaptureLimitsSchema
} as const;

function refineExactAllowlist(
  request: { readonly targetUrl: string; readonly allowedUrls: readonly string[] },
  context: z.RefinementCtx
): void {
  if (!request.allowedUrls.includes(request.targetUrl)) {
    context.addIssue({
      code: "custom",
      path: ["targetUrl"],
      message: "Target is outside the exact allowlist."
    });
  }
  if (new Set(request.allowedUrls).size !== request.allowedUrls.length) {
    context.addIssue({
      code: "custom",
      path: ["allowedUrls"],
      message: "The exact allowlist cannot contain duplicate URLs."
    });
  }
}

export const BrowserNavigationRequestSchema = z
  .object(BrowserExecutionRequestShape)
  .strict()
  .superRefine(refineExactAllowlist);

export const BrowserCaptureRequestSchema = z
  .object({
    ...BrowserExecutionRequestShape,
    committedCursor: ConnectorCursorSchema.nullable()
  })
  .strict()
  .superRefine(refineExactAllowlist);

export const BrowserCurrentTabCaptureRequestSchema = z
  .object({
    nodeId: EntityIdSchema,
    profileId: BrowserProfileIdSchema,
    executionId: EntityIdSchema,
    correlationId: EntityIdSchema,
    expectedUrl: SafeBrowserUrlSchema,
    canonicalUrl: SafeBrowserUrlSchema,
    invocationIdempotencyKey: Sha256Schema,
    requestedAt: IsoDateTimeSchema,
    limits: BrowserCaptureLimitsSchema.extend({
      maxPages: z.literal(1),
      maxRecords: z.literal(1),
      maxConcurrency: z.literal(1)
    })
  })
  .strict();

export const BrowserCancellationReasonSchema = z.enum([
  "user_requested",
  "cancelled_by_policy",
  "orchestration_cancelled"
]);

export const BrowserCancellationRequestSchema = z
  .object({
    nodeId: EntityIdSchema,
    executionId: EntityIdSchema,
    correlationId: EntityIdSchema,
    reason: BrowserCancellationReasonSchema,
    requestedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserCapturedEvidenceSchema = z
  .object({
    captureId: EntityIdSchema,
    sourceUrl: SafeBrowserUrlSchema,
    observedAt: IsoDateTimeSchema,
    mediaType: z.enum(["text/plain", "application/json"]),
    content: z.string().min(1).max(250_000)
  })
  .strict();

const BrowserMetadataValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

export const BrowserCurrentTabEvidenceSchema = z
  .object({
    captureId: EntityIdSchema,
    activeUrl: SafeBrowserUrlSchema,
    canonicalUrl: SafeBrowserUrlSchema,
    pageTitle: z.string().trim().min(1).max(500),
    renderedText: z.string().trim().min(1).max(250_000),
    structuredMetadata: z.record(z.string().trim().min(1).max(80), BrowserMetadataValueSchema),
    imageUrls: z.array(SafeBrowserUrlSchema).max(20),
    observedAt: IsoDateTimeSchema,
    nodeId: EntityIdSchema,
    profileId: BrowserProfileIdSchema,
    contentHash: Sha256Schema
  })
  .strict()
  .superRefine((evidence, context) => {
    if (Object.keys(evidence.structuredMetadata).length > 50) {
      context.addIssue({
        code: "custom",
        path: ["structuredMetadata"],
        message: "Browser capture metadata cannot exceed fifty fields."
      });
    }
  });

export const BrowserManualActionRequiredSchema = z
  .object({
    nodeId: EntityIdSchema,
    executionId: EntityIdSchema,
    blocker: ManualActionBlockerSchema,
    instruction: z.string().trim().min(1).max(500),
    correlationId: EntityIdSchema,
    requiredAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserExecutionStatusSchema = z.enum([
  "completed",
  "manual_action_required",
  "deferred_node_offline",
  "cancelled",
  "retryable_failed",
  "permanently_failed"
]);

export const BrowserExecutionResultSchema = z
  .object({
    providerId: EntityIdSchema,
    nodeId: EntityIdSchema,
    executionId: EntityIdSchema,
    operation: BrowserExecutionOperationSchema,
    status: BrowserExecutionStatusSchema,
    correlationId: EntityIdSchema,
    evidence: z.array(BrowserCapturedEvidenceSchema).max(200),
    recordCount: z.number().int().nonnegative().max(200),
    previousCursor: ConnectorCursorSchema.nullable(),
    cursorCandidate: ConnectorCursorSchema.nullable(),
    manualAction: BrowserManualActionRequiredSchema.nullable(),
    deferredReason: DeferredJobReasonSchema.nullable(),
    error: SourceJobSafeErrorSchema.nullable(),
    completedAt: IsoDateTimeSchema,
    untrustedInput: z.literal(true)
  })
  .strict()
  .superRefine((result, context) => {
    if (result.recordCount !== result.evidence.length) {
      context.addIssue({
        code: "custom",
        path: ["recordCount"],
        message: "Browser result count must match its evidence."
      });
    }

    if (
      result.manualAction !== null &&
      (result.manualAction.nodeId !== result.nodeId ||
        result.manualAction.executionId !== result.executionId ||
        result.manualAction.correlationId !== result.correlationId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Browser manual-action identity must match its execution."
      });
    }

    if (
      result.operation === "navigate" &&
      (result.evidence.length !== 0 ||
        result.previousCursor !== null ||
        result.cursorCandidate !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Navigation cannot capture evidence or advance a cursor."
      });
    }

    const hasNoOutput = result.evidence.length === 0 && result.cursorCandidate === null;
    switch (result.status) {
      case "completed":
        if (
          result.manualAction !== null ||
          result.deferredReason !== null ||
          result.error !== null
        ) {
          context.addIssue({
            code: "custom",
            path: ["status"],
            message: "Completed browser results cannot carry blocker, deferred, or error metadata."
          });
        }
        if (result.cursorCandidate !== null && result.evidence.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["cursorCandidate"],
            message: "A browser cursor candidate requires captured evidence."
          });
        }
        break;
      case "manual_action_required":
        if (
          result.manualAction === null ||
          result.deferredReason !== null ||
          result.error !== null ||
          !hasNoOutput
        ) {
          context.addIssue({
            code: "custom",
            path: ["status"],
            message:
              "Manual-action browser results require one blocker and cannot carry evidence, a cursor candidate, or an error."
          });
        }
        break;
      case "deferred_node_offline":
        if (
          result.deferredReason === null ||
          result.manualAction !== null ||
          result.error !== null ||
          !hasNoOutput
        ) {
          context.addIssue({
            code: "custom",
            path: ["status"],
            message:
              "Deferred browser results require a node reason and cannot carry evidence, a cursor candidate, or an error."
          });
        }
        break;
      case "cancelled":
        if (
          result.manualAction !== null ||
          result.deferredReason !== null ||
          result.error !== null ||
          !hasNoOutput
        ) {
          context.addIssue({
            code: "custom",
            path: ["status"],
            message: "Cancelled browser results cannot carry output or failure metadata."
          });
        }
        break;
      case "retryable_failed":
      case "permanently_failed":
        if (
          result.error === null ||
          result.manualAction !== null ||
          result.deferredReason !== null ||
          !hasNoOutput
        ) {
          context.addIssue({
            code: "custom",
            path: ["status"],
            message:
              "Failed browser results require one safe error and cannot carry evidence or a cursor candidate."
          });
        }
        break;
    }
  });

export const BrowserCurrentTabCaptureResultSchema = z
  .object({
    providerId: EntityIdSchema,
    nodeId: EntityIdSchema,
    profileId: BrowserProfileIdSchema,
    executionId: EntityIdSchema,
    status: BrowserExecutionStatusSchema,
    correlationId: EntityIdSchema,
    evidence: BrowserCurrentTabEvidenceSchema.nullable(),
    manualAction: BrowserManualActionRequiredSchema.nullable(),
    deferredReason: DeferredJobReasonSchema.nullable(),
    error: SourceJobSafeErrorSchema.nullable(),
    completedAt: IsoDateTimeSchema,
    untrustedInput: z.literal(true)
  })
  .strict()
  .superRefine((result, context) => {
    if (result.evidence !== null) {
      if (
        result.evidence.nodeId !== result.nodeId ||
        result.evidence.profileId !== result.profileId
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence"],
          message: "Current-tab evidence must identify the selected node and profile."
        });
      }
    }
    const hasEvidence = result.evidence !== null;
    const hasManual = result.manualAction !== null;
    const hasDeferred = result.deferredReason !== null;
    const hasError = result.error !== null;
    if (result.status === "completed" && (!hasEvidence || hasManual || hasDeferred || hasError)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Completed current-tab capture requires only one evidence envelope."
      });
    }
    if (
      result.status === "manual_action_required" &&
      (!hasManual || hasEvidence || hasDeferred || hasError)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Manual current-tab capture requires only manual-action metadata."
      });
    }
    if (
      result.status === "deferred_node_offline" &&
      (!hasDeferred || hasEvidence || hasManual || hasError)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Deferred current-tab capture requires only a node reason."
      });
    }
    if (
      ["retryable_failed", "permanently_failed"].includes(result.status) &&
      (!hasError || hasEvidence || hasManual || hasDeferred)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Failed current-tab capture requires only one safe error."
      });
    }
    if (result.status === "cancelled" && (hasEvidence || hasManual || hasDeferred || hasError)) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Cancelled current-tab capture cannot carry output."
      });
    }
  });

export const BrowserCancellationResultSchema = z
  .object({
    providerId: EntityIdSchema,
    nodeId: EntityIdSchema,
    executionId: EntityIdSchema,
    correlationId: EntityIdSchema,
    status: z.literal("cancelled"),
    reason: BrowserCancellationReasonSchema,
    requestedAt: IsoDateTimeSchema,
    cancelledAt: IsoDateTimeSchema,
    alreadyCancelled: z.boolean(),
    untrustedInput: z.literal(true)
  })
  .strict();

const MockCompletedOutcomeSchema = z
  .object({
    operation: BrowserExecutionOperationSchema,
    status: z.literal("completed"),
    completedAt: IsoDateTimeSchema,
    evidence: z.array(BrowserCapturedEvidenceSchema).max(200),
    cursorCandidate: ConnectorCursorSchema.nullable()
  })
  .strict();

const MockManualActionOutcomeSchema = z
  .object({
    operation: BrowserExecutionOperationSchema,
    status: z.literal("manual_action_required"),
    blocker: ManualActionBlockerSchema,
    instruction: z.string().trim().min(1).max(500),
    completedAt: IsoDateTimeSchema
  })
  .strict();

const MockDeferredOutcomeSchema = z
  .object({
    operation: BrowserExecutionOperationSchema,
    status: z.literal("deferred_node_offline"),
    deferredReason: DeferredJobReasonSchema,
    completedAt: IsoDateTimeSchema
  })
  .strict();

const MockCancelledOutcomeSchema = z
  .object({
    operation: BrowserExecutionOperationSchema,
    status: z.literal("cancelled"),
    completedAt: IsoDateTimeSchema
  })
  .strict();

const MockFailureOutcomeSchema = z
  .object({
    operation: BrowserExecutionOperationSchema,
    status: z.enum(["retryable_failed", "permanently_failed"]),
    error: SourceJobSafeErrorSchema,
    completedAt: IsoDateTimeSchema
  })
  .strict();

export const MockBrowserOutcomeSchema = z.discriminatedUnion("status", [
  MockCompletedOutcomeSchema,
  MockManualActionOutcomeSchema,
  MockDeferredOutcomeSchema,
  MockCancelledOutcomeSchema,
  MockFailureOutcomeSchema
]);

const MockCurrentTabCompletedOutcomeSchema = z
  .object({
    status: z.literal("completed"),
    completedAt: IsoDateTimeSchema,
    evidence: BrowserCurrentTabEvidenceSchema
  })
  .strict();

const MockCurrentTabManualOutcomeSchema = z
  .object({
    status: z.literal("manual_action_required"),
    blocker: ManualActionBlockerSchema,
    instruction: z.string().trim().min(1).max(500),
    completedAt: IsoDateTimeSchema
  })
  .strict();

const MockCurrentTabDeferredOutcomeSchema = z
  .object({
    status: z.literal("deferred_node_offline"),
    deferredReason: DeferredJobReasonSchema,
    completedAt: IsoDateTimeSchema
  })
  .strict();

const MockCurrentTabCancelledOutcomeSchema = z
  .object({ status: z.literal("cancelled"), completedAt: IsoDateTimeSchema })
  .strict();

const MockCurrentTabFailureOutcomeSchema = z
  .object({
    status: z.enum(["retryable_failed", "permanently_failed"]),
    error: SourceJobSafeErrorSchema,
    completedAt: IsoDateTimeSchema
  })
  .strict();

export const MockCurrentTabOutcomeSchema = z.discriminatedUnion("status", [
  MockCurrentTabCompletedOutcomeSchema,
  MockCurrentTabManualOutcomeSchema,
  MockCurrentTabDeferredOutcomeSchema,
  MockCurrentTabCancelledOutcomeSchema,
  MockCurrentTabFailureOutcomeSchema
]);

export interface BrowserExecutionProvider {
  readonly providerId: string;
  heartbeat(request: BrowserHeartbeatRequest): Promise<BrowserHeartbeatResult>;
  navigate(request: BrowserNavigationRequest): Promise<BrowserExecutionResult>;
  capture(request: BrowserCaptureRequest): Promise<BrowserExecutionResult>;
  captureCurrentTab(
    request: BrowserCurrentTabCaptureRequest
  ): Promise<BrowserCurrentTabCaptureResult>;
  cancel(request: BrowserCancellationRequest): Promise<BrowserCancellationResult>;
}

export interface MockBrowserExecutionProviderOptions {
  readonly nodes?: readonly BrowserNodeStatus[];
  readonly currentTabOutcomes?: readonly MockCurrentTabOutcome[];
  readonly now?: () => Date;
}

type ParsedExecutionRequest = BrowserNavigationRequest | BrowserCaptureRequest;

function previousCursorFor(request: ParsedExecutionRequest): ConnectorCursor | null {
  return "committedCursor" in request ? request.committedCursor : null;
}

function safeFailure(code: string, category: SourceJobSafeError["category"]): SourceJobSafeError {
  return SourceJobSafeErrorSchema.parse({ code, category });
}

export class MockBrowserExecutionProvider implements BrowserExecutionProvider {
  readonly providerId = "mock-openclaw";

  readonly #script: readonly unknown[];
  readonly #nodes = new Map<string, BrowserNodeStatus>();
  readonly #currentTabOutcomes: readonly unknown[];
  readonly #cancelledExecutions = new Set<string>();
  readonly #now: () => Date;
  #scriptIndex = 0;
  #currentTabScriptIndex = 0;

  constructor(
    script: readonly MockBrowserOutcome[] = [],
    options: MockBrowserExecutionProviderOptions = {}
  ) {
    this.#script = script;
    this.#currentTabOutcomes = options.currentTabOutcomes ?? [];
    this.#now = options.now ?? (() => new Date());
    for (const nodeInput of options.nodes ?? []) {
      const node = BrowserNodeStatusSchema.parse(nodeInput);
      if (node.providerId !== this.providerId) {
        throw new Error(`Browser node ${node.nodeId} belongs to a different provider.`);
      }
      this.#nodes.set(node.nodeId, node);
    }
  }

  async heartbeat(input: BrowserHeartbeatRequest): Promise<BrowserHeartbeatResult> {
    const request = BrowserHeartbeatRequestSchema.parse(input);
    const configured = this.#nodes.get(request.nodeId);
    const current = this.safeNow();
    const node = configured
      ? configured.status === "online" && isBrowserNodeStale(configured, current)
        ? BrowserNodeStatusSchema.parse({
            ...configured,
            status: "stale",
            updatedAt: current.toISOString()
          })
        : configured
      : BrowserNodeStatusSchema.parse({
          nodeId: request.nodeId,
          providerId: this.providerId,
          status: "offline",
          lastHeartbeatAt: request.observedAt,
          heartbeatExpiresAt: request.observedAt,
          contractVersion: 1,
          capabilities: {
            navigation: false,
            capture: false,
            cancellation: true
          },
          updatedAt: request.observedAt
        });

    return BrowserHeartbeatResultSchema.parse({
      correlationId: request.correlationId,
      node,
      untrustedInput: true
    });
  }

  async navigate(input: BrowserNavigationRequest): Promise<BrowserExecutionResult> {
    const request = BrowserNavigationRequestSchema.parse(input);
    return this.execute("navigate", request);
  }

  async capture(input: BrowserCaptureRequest): Promise<BrowserExecutionResult> {
    const request = BrowserCaptureRequestSchema.parse(input);
    return this.execute("capture", request);
  }

  async captureCurrentTab(
    input: BrowserCurrentTabCaptureRequest
  ): Promise<BrowserCurrentTabCaptureResult> {
    const request = BrowserCurrentTabCaptureRequestSchema.parse(input);
    const base = {
      providerId: this.providerId,
      nodeId: request.nodeId,
      profileId: request.profileId,
      executionId: request.executionId,
      correlationId: request.correlationId,
      completedAt: this.safeNowIso(),
      untrustedInput: true as const
    };

    if (this.#cancelledExecutions.has(request.executionId)) {
      return BrowserCurrentTabCaptureResultSchema.parse({
        ...base,
        status: "cancelled",
        evidence: null,
        manualAction: null,
        deferredReason: null,
        error: null
      });
    }
    const deferredReason = this.deferredReason(request.nodeId);
    if (deferredReason !== null) {
      return BrowserCurrentTabCaptureResultSchema.parse({
        ...base,
        status: "deferred_node_offline",
        evidence: null,
        manualAction: null,
        deferredReason,
        error: null
      });
    }

    const node = this.#nodes.get(request.nodeId);
    const readinessBlocker =
      node?.pairingState !== "paired"
        ? "node_pairing_required"
        : node.capabilityApprovalState !== "approved"
          ? "capability_approval_required"
          : node.versionCompatibility !== "compatible"
            ? "version_incompatible"
            : node.selectedProfileId !== request.profileId ||
                !node.allowedProfileIds.includes(request.profileId)
              ? "browser_profile_unavailable"
              : null;
    if (readinessBlocker !== null) {
      return BrowserCurrentTabCaptureResultSchema.parse({
        ...base,
        status: "manual_action_required",
        evidence: null,
        manualAction: {
          nodeId: request.nodeId,
          executionId: request.executionId,
          blocker: readinessBlocker,
          instruction: "Complete the required browser-node setup manually.",
          correlationId: request.correlationId,
          requiredAt: base.completedAt
        },
        deferredReason: null,
        error: null
      });
    }

    const rawOutcome = this.#currentTabOutcomes[this.#currentTabScriptIndex];
    if (rawOutcome === undefined) {
      return BrowserCurrentTabCaptureResultSchema.parse({
        ...base,
        status: "permanently_failed",
        evidence: null,
        manualAction: null,
        deferredReason: null,
        error: safeFailure("mock_current_tab_outcome_missing", "internal")
      });
    }
    this.#currentTabScriptIndex += 1;
    const outcome = MockCurrentTabOutcomeSchema.parse(rawOutcome);
    const outcomeBase = { ...base, completedAt: outcome.completedAt };

    switch (outcome.status) {
      case "completed": {
        const byteLength = new TextEncoder().encode(outcome.evidence.renderedText).byteLength;
        if (
          outcome.evidence.activeUrl !== request.expectedUrl ||
          outcome.evidence.canonicalUrl !== request.canonicalUrl ||
          byteLength > request.limits.maxBytes
        ) {
          return BrowserCurrentTabCaptureResultSchema.parse({
            ...outcomeBase,
            status: "permanently_failed",
            evidence: null,
            manualAction: null,
            deferredReason: null,
            error: safeFailure("browser_current_tab_evidence_rejected", "validation")
          });
        }
        return BrowserCurrentTabCaptureResultSchema.parse({
          ...outcomeBase,
          status: "completed",
          evidence: outcome.evidence,
          manualAction: null,
          deferredReason: null,
          error: null
        });
      }
      case "manual_action_required":
        return BrowserCurrentTabCaptureResultSchema.parse({
          ...outcomeBase,
          status: outcome.status,
          evidence: null,
          manualAction: {
            nodeId: request.nodeId,
            executionId: request.executionId,
            blocker: outcome.blocker,
            instruction: outcome.instruction,
            correlationId: request.correlationId,
            requiredAt: outcome.completedAt
          },
          deferredReason: null,
          error: null
        });
      case "deferred_node_offline":
        return BrowserCurrentTabCaptureResultSchema.parse({
          ...outcomeBase,
          status: outcome.status,
          evidence: null,
          manualAction: null,
          deferredReason: outcome.deferredReason,
          error: null
        });
      case "cancelled":
        return BrowserCurrentTabCaptureResultSchema.parse({
          ...outcomeBase,
          status: outcome.status,
          evidence: null,
          manualAction: null,
          deferredReason: null,
          error: null
        });
      case "retryable_failed":
      case "permanently_failed":
        return BrowserCurrentTabCaptureResultSchema.parse({
          ...outcomeBase,
          status: outcome.status,
          evidence: null,
          manualAction: null,
          deferredReason: null,
          error: outcome.error
        });
    }
  }

  async cancel(input: BrowserCancellationRequest): Promise<BrowserCancellationResult> {
    const request = BrowserCancellationRequestSchema.parse(input);
    const alreadyCancelled = this.#cancelledExecutions.has(request.executionId);
    this.#cancelledExecutions.add(request.executionId);

    return BrowserCancellationResultSchema.parse({
      providerId: this.providerId,
      nodeId: request.nodeId,
      executionId: request.executionId,
      correlationId: request.correlationId,
      status: "cancelled",
      reason: request.reason,
      requestedAt: request.requestedAt,
      cancelledAt: this.safeNowIso(),
      alreadyCancelled,
      untrustedInput: true
    });
  }

  private execute(
    operation: BrowserExecutionOperation,
    request: ParsedExecutionRequest
  ): BrowserExecutionResult {
    if (this.#cancelledExecutions.has(request.executionId)) {
      return this.result(request, operation, {
        operation,
        status: "cancelled",
        completedAt: this.safeNowIso()
      });
    }

    const deferredReason = this.deferredReason(request.nodeId);
    if (deferredReason !== null) {
      return this.result(request, operation, {
        operation,
        status: "deferred_node_offline",
        deferredReason,
        completedAt: this.safeNowIso()
      });
    }

    const node = this.#nodes.get(request.nodeId);
    const supportsOperation =
      operation === "navigate" ? node?.capabilities.navigation : node?.capabilities.capture;
    if (supportsOperation !== true) {
      return this.result(request, operation, {
        operation,
        status: "permanently_failed",
        error: safeFailure("browser_capability_unsupported", "permanent_provider"),
        completedAt: this.safeNowIso()
      });
    }

    const rawOutcome = this.#script[this.#scriptIndex];
    if (rawOutcome === undefined) {
      return this.result(request, operation, {
        operation,
        status: "permanently_failed",
        error: safeFailure("mock_outcome_missing", "internal"),
        completedAt: this.safeNowIso()
      });
    }
    this.#scriptIndex += 1;

    const outcome = MockBrowserOutcomeSchema.parse(rawOutcome);
    if (outcome.operation !== operation) {
      return this.result(request, operation, {
        operation,
        status: "permanently_failed",
        error: safeFailure("mock_operation_mismatch", "internal"),
        completedAt: outcome.completedAt
      });
    }

    if (outcome.status === "completed") {
      const evidenceOutsideAllowlist = outcome.evidence.some(
        (item) => !request.allowedUrls.includes(item.sourceUrl)
      );
      const capturedBytes = outcome.evidence.reduce(
        (total, item) => total + new TextEncoder().encode(item.content).byteLength,
        0
      );
      if (
        outcome.evidence.length > request.limits.maxRecords ||
        capturedBytes > request.limits.maxBytes
      ) {
        return this.result(request, operation, {
          operation,
          status: "permanently_failed",
          error: safeFailure("browser_capture_limit_exceeded", "validation"),
          completedAt: outcome.completedAt
        });
      }
      if (evidenceOutsideAllowlist) {
        return this.result(request, operation, {
          operation,
          status: "permanently_failed",
          error: safeFailure("browser_evidence_outside_allowlist", "validation"),
          completedAt: outcome.completedAt
        });
      }
    }

    return this.result(request, operation, outcome);
  }

  private deferredReason(nodeId: string): DeferredJobReason | null {
    const node = this.#nodes.get(nodeId);
    if (node === undefined) return "node_unregistered";
    if (node.status === "revoked") return "node_revoked";
    if (node.status === "offline") return "node_offline";
    if (node.status === "stale" || isBrowserNodeStale(node, this.safeNow())) {
      return "stale_heartbeat";
    }
    return null;
  }

  private result(
    request: ParsedExecutionRequest,
    operation: BrowserExecutionOperation,
    outcome: MockBrowserOutcome
  ): BrowserExecutionResult {
    const base = {
      providerId: this.providerId,
      nodeId: request.nodeId,
      executionId: request.executionId,
      operation,
      correlationId: request.correlationId,
      previousCursor: previousCursorFor(request),
      completedAt: outcome.completedAt,
      untrustedInput: true as const
    };

    switch (outcome.status) {
      case "completed":
        return BrowserExecutionResultSchema.parse({
          ...base,
          status: outcome.status,
          evidence: outcome.evidence,
          recordCount: outcome.evidence.length,
          cursorCandidate: outcome.cursorCandidate,
          manualAction: null,
          deferredReason: null,
          error: null
        });
      case "manual_action_required":
        return BrowserExecutionResultSchema.parse({
          ...base,
          status: outcome.status,
          evidence: [],
          recordCount: 0,
          cursorCandidate: null,
          manualAction: {
            nodeId: request.nodeId,
            executionId: request.executionId,
            blocker: outcome.blocker,
            instruction: outcome.instruction,
            correlationId: request.correlationId,
            requiredAt: outcome.completedAt
          },
          deferredReason: null,
          error: null
        });
      case "deferred_node_offline":
        return BrowserExecutionResultSchema.parse({
          ...base,
          status: outcome.status,
          evidence: [],
          recordCount: 0,
          cursorCandidate: null,
          manualAction: null,
          deferredReason: outcome.deferredReason,
          error: null
        });
      case "cancelled":
        return BrowserExecutionResultSchema.parse({
          ...base,
          status: outcome.status,
          evidence: [],
          recordCount: 0,
          cursorCandidate: null,
          manualAction: null,
          deferredReason: null,
          error: null
        });
      case "retryable_failed":
      case "permanently_failed":
        return BrowserExecutionResultSchema.parse({
          ...base,
          status: outcome.status,
          evidence: [],
          recordCount: 0,
          cursorCandidate: null,
          manualAction: null,
          deferredReason: null,
          error: outcome.error
        });
    }
  }

  private safeNow(): Date {
    const now = this.#now();
    if (Number.isNaN(now.getTime())) throw new RangeError("Browser provider clock is invalid.");
    return now;
  }

  private safeNowIso(): string {
    return this.safeNow().toISOString();
  }
}

export type BrowserExecutionOperation = z.infer<typeof BrowserExecutionOperationSchema>;
export type BrowserHeartbeatRequest = z.infer<typeof BrowserHeartbeatRequestSchema>;
export type BrowserHeartbeatResult = z.infer<typeof BrowserHeartbeatResultSchema>;
export type BrowserNavigationRequest = z.infer<typeof BrowserNavigationRequestSchema>;
export type BrowserCaptureRequest = z.infer<typeof BrowserCaptureRequestSchema>;
export type BrowserCurrentTabCaptureRequest = z.infer<typeof BrowserCurrentTabCaptureRequestSchema>;
export type BrowserCancellationReason = z.infer<typeof BrowserCancellationReasonSchema>;
export type BrowserCancellationRequest = z.infer<typeof BrowserCancellationRequestSchema>;
export type BrowserCapturedEvidence = z.infer<typeof BrowserCapturedEvidenceSchema>;
export type BrowserCurrentTabEvidence = z.infer<typeof BrowserCurrentTabEvidenceSchema>;
export type BrowserManualActionRequired = z.infer<typeof BrowserManualActionRequiredSchema>;
export type BrowserExecutionStatus = z.infer<typeof BrowserExecutionStatusSchema>;
export type BrowserExecutionResult = z.infer<typeof BrowserExecutionResultSchema>;
export type BrowserCurrentTabCaptureResult = z.infer<typeof BrowserCurrentTabCaptureResultSchema>;
export type BrowserCancellationResult = z.infer<typeof BrowserCancellationResultSchema>;
export type MockBrowserOutcome = z.infer<typeof MockBrowserOutcomeSchema>;
export type MockCurrentTabOutcome = z.infer<typeof MockCurrentTabOutcomeSchema>;

export type { BrowserCaptureLimits };
