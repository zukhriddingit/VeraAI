import { z } from "zod";

import { VeraUserIdSchema } from "./identity.ts";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "./primitives.ts";

export const MaritimeDispatchStateSchema = z.enum([
  "pending_wake",
  "accepted",
  "consumed",
  "expired",
  "rejected"
]);

export const MaritimeDispatchIdentitySchema = z
  .object({
    issuer: z.literal("vera-control-plane"),
    audience: EntityIdSchema,
    nonceHash: Sha256Schema,
    payloadHash: Sha256Schema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((identity, context) => {
    if (Date.parse(identity.expiresAt) <= Date.parse(identity.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "A Maritime dispatch must expire after it is issued."
      });
    }
  });

export const MaritimeDispatchSchema = MaritimeDispatchIdentitySchema.extend({
  id: EntityIdSchema,
  userId: VeraUserIdSchema,
  sourceJobId: EntityIdSchema,
  state: MaritimeDispatchStateSchema,
  maritimeAgentId: EntityIdSchema,
  maritimeRunId: EntityIdSchema.nullable(),
  acceptedAt: IsoDateTimeSchema.nullable(),
  consumedAt: IsoDateTimeSchema.nullable(),
  rejectedAt: IsoDateTimeSchema.nullable(),
  rejectionCode: EntityIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema
})
  .strict()
  .superRefine((dispatch, context) => {
    const timestamps = [dispatch.acceptedAt, dispatch.consumedAt, dispatch.rejectedAt].filter(
      (value): value is string => value !== null
    );
    if (timestamps.some((value) => Date.parse(value) < Date.parse(dispatch.issuedAt))) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Dispatch transition times cannot precede issuance."
      });
    }
    if (Date.parse(dispatch.updatedAt) < Date.parse(dispatch.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Dispatch update time cannot precede creation."
      });
    }
    if (dispatch.state === "pending_wake" && timestamps.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "A pending dispatch cannot have transition timestamps."
      });
    }
    if (dispatch.state === "accepted" && dispatch.acceptedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAt"],
        message: "An accepted dispatch requires its acceptance time."
      });
    }
    if (
      dispatch.state === "consumed" &&
      (dispatch.acceptedAt === null || dispatch.consumedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["consumedAt"],
        message: "A consumed dispatch requires acceptance and consumption times."
      });
    }
    if (
      dispatch.state === "rejected" &&
      (dispatch.rejectedAt === null || dispatch.rejectionCode === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rejectedAt"],
        message: "A rejected dispatch requires a safe rejection code and time."
      });
    }
    if (
      dispatch.state !== "rejected" &&
      (dispatch.rejectedAt !== null || dispatch.rejectionCode !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["rejectedAt"],
        message: "Only rejected dispatches can carry rejection metadata."
      });
    }
  });

export const ProductionScheduleKindSchema = z.enum([
  "gmail_alert_ingestion",
  "normalization_reconciliation",
  "decision_reconciliation",
  "stale_listing_check",
  "notification_fanout",
  "health_reconciliation",
  "ephemeral_cleanup"
]);
export const ProductionScheduleStateSchema = z.enum(["enabled", "paused", "disabled_by_policy"]);
export const ProductionScheduleRunStateSchema = z.enum([
  "created",
  "running",
  "completed",
  "retryable_failed",
  "permanently_failed",
  "cancelled_by_policy"
]);

export const ProductionScheduleSchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    kind: ProductionScheduleKindSchema,
    state: ProductionScheduleStateSchema,
    intervalSeconds: z.number().int().min(60).max(31_536_000),
    sourceConfigurationId: EntityIdSchema.nullable(),
    nextRunAt: IsoDateTimeSchema,
    lastRunAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const ProductionScheduleRunSchema = z
  .object({
    id: EntityIdSchema,
    userId: VeraUserIdSchema,
    scheduleId: EntityIdSchema,
    state: ProductionScheduleRunStateSchema,
    dueAt: IsoDateTimeSchema,
    idempotencyKey: Sha256Schema,
    sourceJobId: EntityIdSchema.nullable(),
    attemptCount: z.number().int().nonnegative().max(100),
    safeErrorCode: EntityIdSchema.nullable(),
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const MaritimeDeploymentKindSchema = z.enum(["vera_worker", "openclaw_gateway"]);
export const MaritimeDeploymentStatusSchema = z.enum([
  "unknown",
  "sleeping",
  "starting",
  "running",
  "restarting",
  "unavailable",
  "configuration_error",
  "authentication_error"
]);
export const MaritimeDeploymentSchema = z
  .object({
    id: EntityIdSchema,
    kind: MaritimeDeploymentKindSchema,
    maritimeAgentId: EntityIdSchema,
    environment: z.enum(["development", "staging", "production"]),
    status: MaritimeDeploymentStatusSchema,
    version: z.string().trim().min(1).max(120),
    diagnosticUrl: z.string().url().max(2_048).nullable(),
    lastCheckedAt: IsoDateTimeSchema.nullable(),
    safeErrorCode: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict();

export const ServiceHeartbeatStatusSchema = z.enum(["ready", "degraded", "unavailable"]);
export const ServiceHeartbeatSchema = z
  .object({
    id: EntityIdSchema,
    service: z.enum(["vera-worker", "openclaw-gateway"]),
    deploymentId: EntityIdSchema,
    status: ServiceHeartbeatStatusSchema,
    version: z.string().trim().min(1).max(120),
    checkedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    safeCode: EntityIdSchema.nullable()
  })
  .strict()
  .superRefine((heartbeat, context) => {
    if (Date.parse(heartbeat.expiresAt) <= Date.parse(heartbeat.checkedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "A service heartbeat must expire after it is checked."
      });
    }
  });

const ALLOWED_DISPATCH_TRANSITIONS = {
  pending_wake: ["accepted", "expired", "rejected"],
  accepted: ["consumed", "expired", "rejected"],
  consumed: [],
  expired: [],
  rejected: []
} as const satisfies Record<MaritimeDispatchState, readonly MaritimeDispatchState[]>;

export class InvalidMaritimeDispatchTransitionError extends Error {
  constructor(
    readonly current: MaritimeDispatchState,
    readonly requested: MaritimeDispatchState
  ) {
    super(`Maritime dispatch cannot transition from ${current} to ${requested}.`);
    this.name = "InvalidMaritimeDispatchTransitionError";
  }
}

export function transitionMaritimeDispatch(
  input: MaritimeDispatch,
  requestedInput: MaritimeDispatchState,
  occurredAt: string,
  rejectionCode?: string
): MaritimeDispatch {
  const dispatch = MaritimeDispatchSchema.parse(input);
  const requested = MaritimeDispatchStateSchema.parse(requestedInput);
  const transitionAt = IsoDateTimeSchema.parse(occurredAt);

  if (
    dispatch.state === requested &&
    ["accepted", "consumed", "expired", "rejected"].includes(requested)
  ) {
    return dispatch;
  }
  const allowed: readonly MaritimeDispatchState[] = ALLOWED_DISPATCH_TRANSITIONS[dispatch.state];
  if (!allowed.includes(requested)) {
    throw new InvalidMaritimeDispatchTransitionError(dispatch.state, requested);
  }

  return MaritimeDispatchSchema.parse({
    ...dispatch,
    state: requested,
    acceptedAt: requested === "accepted" ? transitionAt : dispatch.acceptedAt,
    consumedAt: requested === "consumed" ? transitionAt : dispatch.consumedAt,
    rejectedAt: requested === "rejected" ? transitionAt : null,
    rejectionCode:
      requested === "rejected" ? EntityIdSchema.parse(rejectionCode ?? "dispatch_rejected") : null,
    updatedAt: transitionAt
  });
}

export type MaritimeDispatchState = z.infer<typeof MaritimeDispatchStateSchema>;
export type MaritimeDispatch = z.infer<typeof MaritimeDispatchSchema>;
export type ProductionScheduleKind = z.infer<typeof ProductionScheduleKindSchema>;
export type ProductionScheduleState = z.infer<typeof ProductionScheduleStateSchema>;
export type ProductionSchedule = z.infer<typeof ProductionScheduleSchema>;
export type ProductionScheduleRunState = z.infer<typeof ProductionScheduleRunStateSchema>;
export type ProductionScheduleRun = z.infer<typeof ProductionScheduleRunSchema>;
export type MaritimeDeployment = z.infer<typeof MaritimeDeploymentSchema>;
export type MaritimeDeploymentStatus = z.infer<typeof MaritimeDeploymentStatusSchema>;
export type ServiceHeartbeat = z.infer<typeof ServiceHeartbeatSchema>;
