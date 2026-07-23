import { z } from "zod";

import { IsoDateTimeSchema } from "./primitives.ts";

const SafeCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u)
  .nullable();
const CountSchema = z.number().int().nonnegative().max(2_147_483_647);

export const OperationsServiceProjectionSchema = z
  .object({
    status: z.enum(["ready", "degraded", "unavailable", "unknown"]),
    checkedAt: IsoDateTimeSchema,
    safeCode: SafeCodeSchema
  })
  .strict();

export const OperationsMaritimeProjectionSchema = z
  .object({
    status: z.enum(["unknown", "sleeping", "starting", "running", "restarting", "unavailable"]),
    checkedAt: IsoDateTimeSchema,
    diagnosticUrl: z.string().url().max(2_048).nullable(),
    safeCode: SafeCodeSchema
  })
  .strict();

export const OperationsGatewayProjectionSchema = z
  .object({
    status: z.enum(["unknown", "sleeping", "starting", "running", "restarting", "unavailable"]),
    version: z.string().trim().min(1).max(120),
    checkedAt: IsoDateTimeSchema,
    safeCode: SafeCodeSchema
  })
  .strict();

export const OperationsBrowserNodeProjectionSchema = z
  .object({
    status: z.enum(["online", "offline", "stale", "revoked"]),
    pairingState: z.enum(["not_paired", "pairing_pending", "paired", "revoked"]),
    capabilityState: z.enum(["not_approved", "approval_pending", "approved", "revoked"]),
    lastHeartbeatAt: IsoDateTimeSchema,
    version: z.string().trim().min(1).max(120).nullable()
  })
  .strict();

export const OperationsScheduleProjectionSchema = z
  .object({
    kind: z.string().trim().min(1).max(120),
    state: z.enum(["enabled", "paused", "disabled_by_policy"]),
    nextRunAt: IsoDateTimeSchema,
    lastRunAt: IsoDateTimeSchema.nullable(),
    lastOutcome: z.string().trim().min(1).max(120).nullable()
  })
  .strict();

export const OperationsSnapshotSchema = z
  .object({
    generatedAt: IsoDateTimeSchema,
    worker: OperationsServiceProjectionSchema,
    maritime: OperationsMaritimeProjectionSchema,
    gateway: OperationsGatewayProjectionSchema,
    browserNode: OperationsBrowserNodeProjectionSchema.nullable(),
    schedules: z.array(OperationsScheduleProjectionSchema).max(50),
    jobCounts: z
      .object({
        queued: CountSchema,
        running: CountSchema,
        deferred: CountSchema,
        manualAction: CountSchema,
        deadLetter: CountSchema
      })
      .strict(),
    notificationCounts: z
      .object({ queued: CountSchema, delivered: CountSchema, failed: CountSchema })
      .strict(),
    killSwitches: z
      .array(z.object({ source: z.string().trim().min(1).max(120), enabled: z.boolean() }).strict())
      .max(100)
  })
  .strict();

export const OperationsJobControlRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    correlationId: z.string().trim().min(1).max(160)
  })
  .strict();

export type OperationsSnapshot = z.infer<typeof OperationsSnapshotSchema>;
export type OperationsJobControlRequest = z.infer<typeof OperationsJobControlRequestSchema>;
