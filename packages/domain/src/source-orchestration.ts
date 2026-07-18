import { z } from "zod";

import { ErrorCategorySchema } from "./activity.ts";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  ListingSourceLabelSchema,
  Sha256Schema
} from "./primitives.ts";
import {
  AcquisitionModeSchema,
  SourceDomainSchema,
  SourceExecutionSchema
} from "./source-policy.ts";

export const SourceJobStatusSchema = z.enum([
  "queued",
  "dispatched",
  "running",
  "completed",
  "retryable_failed",
  "permanently_failed",
  "deferred_node_offline",
  "manual_action_required",
  "cancelled_by_policy"
]);

export const DeferredJobReasonSchema = z.enum([
  "node_unregistered",
  "node_offline",
  "stale_heartbeat",
  "node_revoked"
]);

export const ManualActionBlockerSchema = z.enum([
  "login",
  "reauthentication",
  "two_factor_authentication",
  "captcha",
  "consent",
  "camera_permission",
  "microphone_permission"
]);

export const ConnectorCursorSchema = z
  .object({
    value: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._~:-]*$/u, "Cursor values must be opaque identifiers."),
    observedAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserCaptureLimitsSchema = z
  .object({
    maxPages: z.number().int().positive().max(20),
    maxRecords: z.number().int().positive().max(200),
    maxBytes: z.number().int().positive().max(25_000_000),
    maxDurationMilliseconds: z.number().int().positive().max(900_000),
    maxConcurrency: z.literal(1)
  })
  .strict();

const SafeBrowserUrlPattern =
  /^https?:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?:[/?][^\s#]*)?$/iu;
const SensitiveUrlQueryKeys = new Set([
  "password",
  "passwd",
  "pass",
  "pwd",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "auth",
  "secret",
  "api_key",
  "apikey",
  "cookie",
  "session",
  "sessionid"
]);

function validateBrowserUrlQuery(value: string): "invalid_encoding" | "sensitive_key" | null {
  const queryStart = value.indexOf("?");
  if (queryStart === -1) {
    return null;
  }

  const query = value.slice(queryStart + 1);
  try {
    // Some URL parsers replace malformed escapes instead of rejecting them, so validate first.
    decodeURIComponent(query.replace(/\+/gu, "%20"));
  } catch {
    return "invalid_encoding";
  }

  for (const parameter of query.split("&")) {
    const separatorIndex = parameter.indexOf("=");
    const encodedKey = separatorIndex === -1 ? parameter : parameter.slice(0, separatorIndex);
    const key = decodeURIComponent(encodedKey.replace(/\+/gu, "%20")).trim().toLowerCase();
    if (SensitiveUrlQueryKeys.has(key)) {
      return "sensitive_key";
    }
  }

  return null;
}

export const SafeBrowserUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const hostname = value.match(SafeBrowserUrlPattern)?.[1];
    if (hostname === undefined || !SourceDomainSchema.safeParse(hostname).success) {
      context.addIssue({
        code: "custom",
        message:
          "Browser URLs require HTTP(S), an exact public DNS hostname, and no credentials, ports, or fragments."
      });
    }
    const queryValidation = validateBrowserUrlQuery(value);
    if (queryValidation === "invalid_encoding") {
      context.addIssue({
        code: "custom",
        message: "Browser URL query strings must use valid percent encoding."
      });
    }
    if (queryValidation === "sensitive_key") {
      context.addIssue({
        code: "custom",
        message: "Browser URLs cannot carry credential-like query parameters."
      });
    }
  });

export const SourceJobPayloadSchema = z.discriminatedUnion("acquisitionMode", [
  z
    .object({
      acquisitionMode: z.literal("fixture"),
      fixtureSetId: EntityIdSchema
    })
    .strict(),
  z
    .object({
      acquisitionMode: z.literal("user_capture"),
      captureReference: EntityIdSchema
    })
    .strict(),
  z
    .object({
      acquisitionMode: z.enum(["official_api", "email_alert"]),
      sourceConfigurationId: EntityIdSchema,
      committedCursor: ConnectorCursorSchema.nullable()
    })
    .strict(),
  z
    .object({
      acquisitionMode: z.literal("local_browser"),
      nodeId: EntityIdSchema,
      savedSearchId: EntityIdSchema,
      savedSearchUrl: SafeBrowserUrlSchema,
      committedCursor: ConnectorCursorSchema.nullable(),
      limits: BrowserCaptureLimitsSchema
    })
    .strict()
]);

export const SourceJobSafeErrorSchema = z
  .object({
    code: EntityIdSchema,
    category: ErrorCategorySchema
  })
  .strict();

export const ManualActionRequiredSchema = z
  .object({
    jobId: EntityIdSchema,
    nodeId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    blocker: ManualActionBlockerSchema,
    instruction: z.string().trim().min(1).max(500),
    correlationId: EntityIdSchema,
    requiredAt: IsoDateTimeSchema
  })
  .strict();

export const BrowserNodeStateSchema = z.enum(["online", "offline", "stale", "revoked"]);

export const BrowserNodeCapabilitiesSchema = z
  .object({
    navigation: z.boolean(),
    capture: z.boolean(),
    cancellation: z.boolean()
  })
  .strict();

export const BrowserNodeStatusSchema = z
  .object({
    nodeId: EntityIdSchema,
    providerId: EntityIdSchema,
    status: BrowserNodeStateSchema,
    lastHeartbeatAt: IsoDateTimeSchema,
    heartbeatExpiresAt: IsoDateTimeSchema,
    contractVersion: z.number().int().positive().max(1_000),
    capabilities: BrowserNodeCapabilitiesSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((node, context) => {
    if (Date.parse(node.heartbeatExpiresAt) < Date.parse(node.lastHeartbeatAt)) {
      context.addIssue({
        code: "custom",
        path: ["heartbeatExpiresAt"],
        message: "Heartbeat expiry cannot precede the heartbeat."
      });
    }
    if (Date.parse(node.updatedAt) < Date.parse(node.lastHeartbeatAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Node update time cannot precede the heartbeat."
      });
    }
  });

export const SourceJobResultStatusSchema = z.enum(["completed", "unsupported_operation", "failed"]);

export const SourceJobResultSchema = z
  .object({
    jobId: EntityIdSchema,
    connectorId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    acquisitionMode: AcquisitionModeSchema,
    operation: z.string().trim().min(1).max(160),
    status: SourceJobResultStatusSchema,
    correlationId: EntityIdSchema,
    payloadHash: Sha256Schema,
    idempotencyKey: Sha256Schema,
    resultHash: Sha256Schema,
    recordCount: z.number().int().nonnegative().max(200),
    previousCursor: ConnectorCursorSchema.nullable(),
    cursorCandidate: ConnectorCursorSchema.nullable(),
    error: SourceJobSafeErrorSchema.nullable(),
    completedAt: IsoDateTimeSchema,
    idempotentReplay: z.boolean(),
    untrustedInput: z.literal(true)
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "completed" && result.error !== null) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Completed source-job results cannot carry an error."
      });
    }
    if (result.status !== "completed") {
      if (result.error === null) {
        context.addIssue({
          code: "custom",
          path: ["error"],
          message: "Non-success source-job results require a safe typed error."
        });
      }
      if (result.recordCount !== 0 || result.cursorCandidate !== null) {
        context.addIssue({
          code: "custom",
          path: ["recordCount"],
          message: "Non-success source-job results cannot contain records or a cursor candidate."
        });
      }
    }
  });

export const SourceJobSchema = z
  .object({
    id: EntityIdSchema,
    correlationId: EntityIdSchema,
    connectorId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    acquisitionMode: AcquisitionModeSchema,
    manifestVersion: z.number().int().positive(),
    trigger: SourceExecutionSchema,
    operation: z.string().trim().min(1).max(160),
    payload: SourceJobPayloadSchema,
    payloadHash: Sha256Schema,
    idempotencyKey: Sha256Schema,
    status: SourceJobStatusSchema,
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive().max(100),
    manualAction: ManualActionRequiredSchema.nullable(),
    deferredReason: DeferredJobReasonSchema.nullable(),
    result: SourceJobResultSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable()
  })
  .strict()
  .superRefine((job, context) => {
    if (job.acquisitionMode !== job.payload.acquisitionMode) {
      context.addIssue({
        code: "custom",
        path: ["payload", "acquisitionMode"],
        message: "Source-job payload mode must match the connector acquisition mode."
      });
    }
    if (job.attempts > job.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "Source-job attempts cannot exceed the configured maximum."
      });
    }
    if (Date.parse(job.updatedAt) < Date.parse(job.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Source-job update time cannot precede creation time."
      });
    }

    const isManual = job.status === "manual_action_required";
    if (isManual !== (job.manualAction !== null)) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Only manual-action jobs require manual-action metadata."
      });
    }
    if (
      job.manualAction !== null &&
      (job.manualAction.jobId !== job.id ||
        job.manualAction.source !== job.source ||
        job.manualAction.correlationId !== job.correlationId ||
        job.payload.acquisitionMode !== "local_browser" ||
        job.manualAction.nodeId !== job.payload.nodeId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manualAction"],
        message: "Manual-action metadata must identify its source job."
      });
    }

    const isDeferred = job.status === "deferred_node_offline";
    if (isDeferred !== (job.deferredReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["deferredReason"],
        message: "Only deferred-node-offline jobs require a deferred reason."
      });
    }
    if (isDeferred && job.payload.acquisitionMode !== "local_browser") {
      context.addIssue({
        code: "custom",
        path: ["deferredReason"],
        message: "Only local-browser jobs can be deferred for node health."
      });
    }

    if (job.status === "completed" && job.result?.status !== "completed") {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Completed source jobs require a completed result."
      });
    }
    if (
      [
        "queued",
        "dispatched",
        "running",
        "deferred_node_offline",
        "manual_action_required",
        "cancelled_by_policy"
      ].includes(job.status) &&
      job.result !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "This source-job state cannot carry a connector result."
      });
    }
    if (
      job.result !== null &&
      (job.result.jobId !== job.id ||
        job.result.connectorId !== job.connectorId ||
        job.result.source !== job.source ||
        job.result.acquisitionMode !== job.acquisitionMode ||
        job.result.operation !== job.operation ||
        job.result.correlationId !== job.correlationId ||
        job.result.payloadHash !== job.payloadHash ||
        job.result.idempotencyKey !== job.idempotencyKey)
    ) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "Source-job result identity must match its job."
      });
    }
    if (job.result !== null) {
      const committedCursor = "committedCursor" in job.payload ? job.payload.committedCursor : null;
      const previousCursor = job.result.previousCursor;
      const cursorMatches =
        committedCursor === previousCursor ||
        (committedCursor !== null &&
          previousCursor !== null &&
          committedCursor.value === previousCursor.value &&
          committedCursor.observedAt === previousCursor.observedAt);
      if (!cursorMatches) {
        context.addIssue({
          code: "custom",
          path: ["result", "previousCursor"],
          message: "Source-job result must start from the job's committed cursor."
        });
      }
      if (
        !["official_api", "email_alert", "local_browser"].includes(job.acquisitionMode) &&
        job.result.cursorCandidate !== null
      ) {
        context.addIssue({
          code: "custom",
          path: ["result", "cursorCandidate"],
          message: "This acquisition mode cannot produce a cursor candidate."
        });
      }
    }

    const terminal = ["completed", "permanently_failed", "cancelled_by_policy"].includes(
      job.status
    );
    if (terminal !== (job.completedAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Only terminal source jobs require a completion time."
      });
    }
    if (job.completedAt !== null && Date.parse(job.completedAt) < Date.parse(job.updatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Source-job completion time cannot precede its last update."
      });
    }
  });

export const SourceJobAttemptOutcomeStatusSchema = z.enum([
  "completed",
  "retryable_failed",
  "permanently_failed",
  "deferred_node_offline",
  "manual_action_required",
  "cancelled_by_policy"
]);

export const JobAttemptSchema = z
  .object({
    id: EntityIdSchema,
    sourceJobId: EntityIdSchema,
    attemptNumber: z.number().int().positive().max(100),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    outcomeStatus: SourceJobAttemptOutcomeStatusSchema,
    error: SourceJobSafeErrorSchema.nullable(),
    deferredReason: DeferredJobReasonSchema.nullable(),
    correlationId: EntityIdSchema,
    payloadHash: Sha256Schema
  })
  .strict()
  .superRefine((attempt, context) => {
    if (Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Attempt completion cannot precede its start."
      });
    }

    const isFailure = ["retryable_failed", "permanently_failed"].includes(attempt.outcomeStatus);
    if (isFailure !== (attempt.error !== null)) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Failed attempts require exactly one safe typed error."
      });
    }

    const isDeferred = attempt.outcomeStatus === "deferred_node_offline";
    if (isDeferred !== (attempt.deferredReason !== null)) {
      context.addIssue({
        code: "custom",
        path: ["deferredReason"],
        message: "Only deferred attempts require a deferred reason."
      });
    }
  });

export const ALLOWED_SOURCE_JOB_TRANSITIONS = {
  queued: ["dispatched", "cancelled_by_policy"],
  dispatched: [
    "running",
    "deferred_node_offline",
    "manual_action_required",
    "retryable_failed",
    "permanently_failed",
    "cancelled_by_policy"
  ],
  running: [
    "completed",
    "retryable_failed",
    "permanently_failed",
    "manual_action_required",
    "cancelled_by_policy"
  ],
  retryable_failed: ["queued", "permanently_failed", "cancelled_by_policy"],
  deferred_node_offline: ["queued", "cancelled_by_policy"],
  manual_action_required: ["queued", "cancelled_by_policy"],
  completed: [],
  permanently_failed: [],
  cancelled_by_policy: []
} as const satisfies Record<SourceJobStatus, readonly SourceJobStatus[]>;

export class InvalidSourceJobTransitionError extends Error {
  readonly current: SourceJobStatus;
  readonly requested: SourceJobStatus;

  constructor(current: SourceJobStatus, requested: SourceJobStatus) {
    super(`Source job cannot transition from ${current} to ${requested}.`);
    this.name = "InvalidSourceJobTransitionError";
    this.current = current;
    this.requested = requested;
  }
}

export function transitionSourceJobStatus(
  currentInput: SourceJobStatus,
  requestedInput: SourceJobStatus
): SourceJobStatus {
  const current = SourceJobStatusSchema.parse(currentInput);
  const requested = SourceJobStatusSchema.parse(requestedInput);
  const allowed: readonly SourceJobStatus[] = ALLOWED_SOURCE_JOB_TRANSITIONS[current];

  if (!allowed.includes(requested)) {
    throw new InvalidSourceJobTransitionError(current, requested);
  }
  return requested;
}

export function isBrowserNodeStale(nodeInput: BrowserNodeStatus, now: Date): boolean {
  const node = BrowserNodeStatusSchema.parse(nodeInput);
  const nowMilliseconds = now.getTime();
  if (Number.isNaN(nowMilliseconds)) {
    throw new RangeError("Browser node staleness requires a valid clock value.");
  }
  return node.status === "stale" || nowMilliseconds >= Date.parse(node.heartbeatExpiresAt);
}

export type ConnectorCursor = z.infer<typeof ConnectorCursorSchema>;
export type BrowserCaptureLimits = z.infer<typeof BrowserCaptureLimitsSchema>;
export type SourceJobPayload = z.infer<typeof SourceJobPayloadSchema>;
export type SourceJobSafeError = z.infer<typeof SourceJobSafeErrorSchema>;
export type ManualActionBlocker = z.infer<typeof ManualActionBlockerSchema>;
export type ManualActionRequired = z.infer<typeof ManualActionRequiredSchema>;
export type DeferredJobReason = z.infer<typeof DeferredJobReasonSchema>;
export type BrowserNodeState = z.infer<typeof BrowserNodeStateSchema>;
export type BrowserNodeCapabilities = z.infer<typeof BrowserNodeCapabilitiesSchema>;
export type BrowserNodeStatus = z.infer<typeof BrowserNodeStatusSchema>;
export type SourceJobResultStatus = z.infer<typeof SourceJobResultStatusSchema>;
export type SourceJobResult = z.infer<typeof SourceJobResultSchema>;
export type SourceJobStatus = z.infer<typeof SourceJobStatusSchema>;
export type SourceJob = z.infer<typeof SourceJobSchema>;
export type SourceJobAttemptOutcomeStatus = z.infer<typeof SourceJobAttemptOutcomeStatusSchema>;
export type JobAttempt = z.infer<typeof JobAttemptSchema>;
