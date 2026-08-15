import {
  BrowserConnectorGatewayOriginSchema,
  BrowserConnectorInstallationDigestSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  VeraUserIdSchema,
  type VeraUserId
} from "@vera/domain";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { z } from "zod";

import type { PostgresConnection } from "./connection.ts";
import { mapPostgresError } from "./errors.ts";
import {
  browserConnectorDevices,
  browserConnectorEnrollmentTickets,
  browserGatewayAssignments
} from "./schema.ts";

const ExtensionVersionSchema = z.string().trim().min(1).max(32);
const ProtocolVersionSchema = z.string().trim().min(1).max(16);

const IssueInputSchema = z
  .object({
    id: z.uuid(),
    deviceId: z.uuid(),
    userId: VeraUserIdSchema,
    assignmentId: z.uuid(),
    installationDigest: BrowserConnectorInstallationDigestSchema,
    ticketDigest: Sha256Schema,
    extensionVersion: z.literal("2.2.0"),
    protocolVersion: z.literal("1"),
    gatewayOrigin: BrowserConnectorGatewayOriginSchema,
    idempotencyKey: Sha256Schema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema
  })
  .strict();

const ConsumeInputSchema = z
  .object({
    userId: VeraUserIdSchema,
    assignmentId: z.uuid(),
    ticketDigest: Sha256Schema,
    installationDigest: BrowserConnectorInstallationDigestSchema,
    extensionVersion: ExtensionVersionSchema,
    protocolVersion: ProtocolVersionSchema,
    gatewayOrigin: BrowserConnectorGatewayOriginSchema,
    consumedAt: IsoDateTimeSchema
  })
  .strict();

const EnrollmentTicketSchema = z
  .object({
    id: z.uuid(),
    assignmentId: z.uuid(),
    userId: VeraUserIdSchema,
    deviceId: z.uuid(),
    installationDigest: BrowserConnectorInstallationDigestSchema,
    ticketDigest: Sha256Schema,
    extensionVersion: z.literal("2.2.0"),
    protocolVersion: z.literal("1"),
    gatewayOrigin: BrowserConnectorGatewayOriginSchema,
    idempotencyKey: Sha256Schema,
    status: z.enum(["issued", "consumed", "expired", "revoked"]),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    consumedAt: IsoDateTimeSchema.nullable(),
    terminalAt: IsoDateTimeSchema.nullable(),
    terminalReason: z.enum(["expired", "revoked"]).nullable()
  })
  .strict();

export type IssueBrowserConnectorEnrollmentInput = z.input<typeof IssueInputSchema>;
export type ConsumeBrowserConnectorEnrollmentInput = z.input<typeof ConsumeInputSchema>;
export type BrowserConnectorEnrollmentTicket = z.infer<typeof EnrollmentTicketSchema>;

export type BrowserConnectorEnrollmentConsumeResult =
  | { readonly outcome: "consumed"; readonly ticket: BrowserConnectorEnrollmentTicket }
  | {
      readonly outcome:
        | "ticket_invalid"
        | "ticket_expired"
        | "ticket_replayed"
        | "binding_mismatch"
        | "version_incompatible"
        | "device_conflict";
    };

export class BrowserConnectorEnrollmentIssueError extends Error {
  constructor(readonly code: "assignment_unavailable" | "device_conflict" | "ticket_active") {
    super(
      code === "assignment_unavailable"
        ? "Active browser assignment is unavailable."
        : code === "device_conflict"
          ? "Another browser device is active for this assignment."
          : "An active enrollment ticket already exists."
    );
    this.name = "BrowserConnectorEnrollmentIssueError";
  }
}

export interface BrowserConnectorEnrollmentRepository {
  issue(input: IssueBrowserConnectorEnrollmentInput): Promise<BrowserConnectorEnrollmentTicket>;
  consume(
    input: ConsumeBrowserConnectorEnrollmentInput
  ): Promise<BrowserConnectorEnrollmentConsumeResult>;
  revokeForUser(input: {
    readonly userId: VeraUserId;
    readonly revokedAt: string;
  }): Promise<number>;
  expireBatch(input: { readonly now: string; readonly limit: number }): Promise<number>;
}

type TicketRow = typeof browserConnectorEnrollmentTickets.$inferSelect;

function mapTicket(row: TicketRow): BrowserConnectorEnrollmentTicket {
  return EnrollmentTicketSchema.parse({
    ...row,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
    terminalAt: row.terminalAt?.toISOString() ?? null
  });
}

function required<Row>(row: Row | undefined, message: string): Row {
  if (!row) throw new Error(message);
  return row;
}

async function mapped<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof BrowserConnectorEnrollmentIssueError) throw error;
    throw mapPostgresError(error);
  }
}

export function createPostgresBrowserConnectorEnrollmentRepository(
  connection: Pick<PostgresConnection, "db">
): BrowserConnectorEnrollmentRepository {
  return {
    async issue(inputRaw) {
      const input = IssueInputSchema.parse(inputRaw);
      return mapped(() =>
        connection.db.transaction(async (transaction) => {
          const issuedInstant = new Date(input.issuedAt);
          const assignmentRows = await transaction
            .select()
            .from(browserGatewayAssignments)
            .where(
              and(
                eq(browserGatewayAssignments.id, input.assignmentId),
                eq(browserGatewayAssignments.userId, input.userId),
                eq(browserGatewayAssignments.status, "active")
              )
            )
            .for("update")
            .limit(1);
          const assignment = assignmentRows[0];
          if (!assignment || assignment.gatewayOrigin !== input.gatewayOrigin) {
            throw new BrowserConnectorEnrollmentIssueError("assignment_unavailable");
          }

          const expiredRows = await transaction
            .select({ id: browserConnectorEnrollmentTickets.id })
            .from(browserConnectorEnrollmentTickets)
            .where(
              and(
                eq(browserConnectorEnrollmentTickets.assignmentId, input.assignmentId),
                eq(browserConnectorEnrollmentTickets.status, "issued"),
                lte(browserConnectorEnrollmentTickets.expiresAt, issuedInstant)
              )
            )
            .for("update");
          if (expiredRows.length > 0) {
            await transaction
              .update(browserConnectorEnrollmentTickets)
              .set({
                status: "expired",
                terminalAt: issuedInstant,
                terminalReason: "expired"
              })
              .where(
                inArray(
                  browserConnectorEnrollmentTickets.id,
                  expiredRows.map((row) => row.id)
                )
              );
          }

          const activeTicket = await transaction
            .select({ id: browserConnectorEnrollmentTickets.id })
            .from(browserConnectorEnrollmentTickets)
            .where(
              and(
                eq(browserConnectorEnrollmentTickets.assignmentId, input.assignmentId),
                eq(browserConnectorEnrollmentTickets.status, "issued")
              )
            )
            .for("update")
            .limit(1);
          if (activeTicket[0]) throw new BrowserConnectorEnrollmentIssueError("ticket_active");

          const deviceRows = await transaction
            .select()
            .from(browserConnectorDevices)
            .where(
              and(
                eq(browserConnectorDevices.assignmentId, input.assignmentId),
                inArray(browserConnectorDevices.status, ["pending", "active"])
              )
            )
            .for("update")
            .limit(1);
          let device = deviceRows[0];
          if (device && device.installationDigest !== input.installationDigest) {
            if (device.status === "active") {
              throw new BrowserConnectorEnrollmentIssueError("device_conflict");
            }
            await transaction
              .update(browserConnectorDevices)
              .set({ status: "revoked", revokedAt: issuedInstant })
              .where(eq(browserConnectorDevices.id, device.id));
            device = undefined;
          }
          if (!device) {
            const insertedDevices = await transaction
              .insert(browserConnectorDevices)
              .values({
                id: input.deviceId,
                assignmentId: input.assignmentId,
                userId: input.userId,
                installationDigest: input.installationDigest,
                extensionVersion: input.extensionVersion,
                protocolVersion: input.protocolVersion,
                status: "pending",
                createdAt: issuedInstant,
                connectedAt: null,
                lastSeenAt: null,
                revokedAt: null
              })
              .returning();
            device = required(insertedDevices[0], "Enrollment device insert returned no row.");
          }

          const inserted = await transaction
            .insert(browserConnectorEnrollmentTickets)
            .values({
              id: input.id,
              assignmentId: input.assignmentId,
              userId: input.userId,
              deviceId: device.id,
              installationDigest: input.installationDigest,
              ticketDigest: input.ticketDigest,
              extensionVersion: input.extensionVersion,
              protocolVersion: input.protocolVersion,
              gatewayOrigin: input.gatewayOrigin,
              idempotencyKey: input.idempotencyKey,
              status: "issued",
              issuedAt: issuedInstant,
              expiresAt: new Date(input.expiresAt),
              consumedAt: null,
              terminalAt: null,
              terminalReason: null
            })
            .returning();
          return mapTicket(required(inserted[0], "Enrollment ticket insert returned no row."));
        })
      );
    },

    async consume(inputRaw) {
      const input = ConsumeInputSchema.parse(inputRaw);
      return mapped(() =>
        connection.db.transaction(async (transaction) => {
          const consumedInstant = new Date(input.consumedAt);
          const assignmentRows = await transaction
            .select()
            .from(browserGatewayAssignments)
            .where(
              and(
                eq(browserGatewayAssignments.id, input.assignmentId),
                eq(browserGatewayAssignments.userId, input.userId),
                eq(browserGatewayAssignments.status, "active")
              )
            )
            .for("update")
            .limit(1);
          const assignment = assignmentRows[0];
          if (!assignment) return { outcome: "ticket_invalid" } as const;

          const ticketRows = await transaction
            .select()
            .from(browserConnectorEnrollmentTickets)
            .where(eq(browserConnectorEnrollmentTickets.ticketDigest, input.ticketDigest))
            .for("update")
            .limit(1);
          const ticket = ticketRows[0];
          if (
            !ticket ||
            ticket.userId !== input.userId ||
            ticket.assignmentId !== input.assignmentId
          ) {
            return { outcome: "ticket_invalid" } as const;
          }
          if (ticket.status === "consumed") return { outcome: "ticket_replayed" } as const;
          if (ticket.status === "expired") return { outcome: "ticket_expired" } as const;
          if (ticket.status !== "issued") return { outcome: "ticket_invalid" } as const;
          if (ticket.expiresAt.getTime() <= consumedInstant.getTime()) {
            await transaction
              .update(browserConnectorEnrollmentTickets)
              .set({
                status: "expired",
                terminalAt: consumedInstant,
                terminalReason: "expired"
              })
              .where(eq(browserConnectorEnrollmentTickets.id, ticket.id));
            return { outcome: "ticket_expired" } as const;
          }
          if (
            ticket.extensionVersion !== input.extensionVersion ||
            ticket.protocolVersion !== input.protocolVersion
          ) {
            return { outcome: "version_incompatible" } as const;
          }
          if (
            ticket.installationDigest !== input.installationDigest ||
            ticket.gatewayOrigin !== input.gatewayOrigin ||
            assignment.gatewayOrigin !== input.gatewayOrigin
          ) {
            return { outcome: "binding_mismatch" } as const;
          }

          const deviceRows = await transaction
            .select()
            .from(browserConnectorDevices)
            .where(
              and(
                eq(browserConnectorDevices.id, ticket.deviceId),
                eq(browserConnectorDevices.userId, input.userId),
                eq(browserConnectorDevices.assignmentId, input.assignmentId)
              )
            )
            .for("update")
            .limit(1);
          const device = deviceRows[0];
          if (!device || device.status === "revoked") {
            return { outcome: "device_conflict" } as const;
          }
          if (device.installationDigest !== input.installationDigest) {
            return { outcome: "binding_mismatch" } as const;
          }

          const updatedTickets = await transaction
            .update(browserConnectorEnrollmentTickets)
            .set({
              status: "consumed",
              consumedAt: consumedInstant,
              terminalAt: consumedInstant,
              terminalReason: null
            })
            .where(
              and(
                eq(browserConnectorEnrollmentTickets.id, ticket.id),
                eq(browserConnectorEnrollmentTickets.status, "issued")
              )
            )
            .returning();
          await transaction
            .update(browserConnectorDevices)
            .set({
              status: "active",
              connectedAt: device.connectedAt ?? consumedInstant,
              lastSeenAt: consumedInstant,
              revokedAt: null
            })
            .where(eq(browserConnectorDevices.id, device.id));
          return {
            outcome: "consumed",
            ticket: mapTicket(
              required(updatedTickets[0], "Enrollment ticket was not consumed atomically.")
            )
          } as const;
        })
      );
    },

    async revokeForUser(inputRaw) {
      const input = z
        .object({ userId: VeraUserIdSchema, revokedAt: IsoDateTimeSchema })
        .strict()
        .parse(inputRaw);
      return mapped(() =>
        connection.db.transaction(async (transaction) => {
          const revokedInstant = new Date(input.revokedAt);
          await transaction
            .update(browserConnectorEnrollmentTickets)
            .set({ status: "revoked", terminalAt: revokedInstant, terminalReason: "revoked" })
            .where(
              and(
                eq(browserConnectorEnrollmentTickets.userId, input.userId),
                eq(browserConnectorEnrollmentTickets.status, "issued")
              )
            );
          const revokedDevices = await transaction
            .update(browserConnectorDevices)
            .set({ status: "revoked", revokedAt: revokedInstant })
            .where(
              and(
                eq(browserConnectorDevices.userId, input.userId),
                inArray(browserConnectorDevices.status, ["pending", "active"])
              )
            )
            .returning({ id: browserConnectorDevices.id });
          return revokedDevices.length;
        })
      );
    },

    async expireBatch(inputRaw) {
      const input = z
        .object({
          now: IsoDateTimeSchema,
          limit: z.number().int().positive().max(1_000)
        })
        .strict()
        .parse(inputRaw);
      return mapped(() =>
        connection.db.transaction(async (transaction) => {
          const now = new Date(input.now);
          const rows = await transaction
            .select({ id: browserConnectorEnrollmentTickets.id })
            .from(browserConnectorEnrollmentTickets)
            .where(
              and(
                eq(browserConnectorEnrollmentTickets.status, "issued"),
                lte(browserConnectorEnrollmentTickets.expiresAt, now)
              )
            )
            .orderBy(asc(browserConnectorEnrollmentTickets.expiresAt))
            .limit(input.limit)
            .for("update", { skipLocked: true });
          if (rows.length === 0) return 0;
          const updated = await transaction
            .update(browserConnectorEnrollmentTickets)
            .set({ status: "expired", terminalAt: now, terminalReason: "expired" })
            .where(
              and(
                inArray(
                  browserConnectorEnrollmentTickets.id,
                  rows.map((row) => row.id)
                ),
                eq(browserConnectorEnrollmentTickets.status, "issued")
              )
            )
            .returning({ id: browserConnectorEnrollmentTickets.id });
          return updated.length;
        })
      );
    }
  };
}
