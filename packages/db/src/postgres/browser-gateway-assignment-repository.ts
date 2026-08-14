import {
  BrowserGatewayAssignmentSchema,
  BrowserResearchSourceSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  VeraUserIdSchema,
  type BrowserGatewayAssignment,
  type BrowserResearchSource,
  type VeraUserId
} from "@vera/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { PostgresConnection } from "./connection.ts";
import { mapPostgresError } from "./errors.ts";
import {
  browserGatewayAcceptanceRuns,
  browserGatewayAssignments,
  browserNodes,
  browserProfileControls,
  browserSourceControls,
  browserUserControls
} from "./schema.ts";

type CreatePendingAssignmentInput = Pick<
  BrowserGatewayAssignment,
  | "id"
  | "userId"
  | "nodeId"
  | "maritimeAgentId"
  | "gatewayOrigin"
  | "checkpointOrigin"
  | "secretReference"
  | "relayCredentialDigest"
  | "checkpointCredentialDigest"
  | "createdAt"
>;

const AcceptanceInputSchema = z
  .object({
    id: z.uuid(),
    assignmentId: z.uuid(),
    userId: VeraUserIdSchema,
    sourceJobId: EntityIdSchema,
    source: BrowserResearchSourceSchema,
    forbiddenActionCount: z.number().int().nonnegative(),
    unshareStoppedFutureWork: z.boolean(),
    unpairVerified: z.boolean(),
    completedAt: IsoDateTimeSchema
  })
  .strict();

export interface BrowserGatewayAcceptanceRun {
  readonly id: string;
  readonly assignmentId: string;
  readonly userId: VeraUserId;
  readonly sourceJobId: string;
  readonly source: BrowserResearchSource;
  readonly forbiddenActionCount: number;
  readonly unshareStoppedFutureWork: boolean;
  readonly unpairVerified: boolean;
  readonly completedAt: string;
}

export interface BrowserGatewayAcceptanceSummary {
  readonly completedRuns: number;
  readonly distinctUsers: number;
  readonly forbiddenActionCount: number;
  readonly unsharePasses: number;
  readonly unpairPasses: number;
}

export interface BrowserGatewayAssignmentRepository {
  createPending(input: CreatePendingAssignmentInput): Promise<BrowserGatewayAssignment>;
  activate(input: {
    readonly assignmentId: string;
    readonly activatedAt: string;
  }): Promise<BrowserGatewayAssignment>;
  getActiveForUser(userId: VeraUserId): Promise<BrowserGatewayAssignment | null>;
  getLatestForUser(userId: VeraUserId): Promise<BrowserGatewayAssignment | null>;
  getActiveByCheckpointDigest(digest: string): Promise<BrowserGatewayAssignment | null>;
  listEnabledConnectorIdsForUser(userId: VeraUserId): Promise<readonly string[]>;
  revokeForUser(input: {
    readonly userId: VeraUserId;
    readonly revokedAt: string;
  }): Promise<BrowserGatewayAssignment | null>;
  recordAcceptance(
    input: z.input<typeof AcceptanceInputSchema>
  ): Promise<BrowserGatewayAcceptanceRun>;
  summarizeAcceptance(): Promise<BrowserGatewayAcceptanceSummary>;
}

type AssignmentRow = typeof browserGatewayAssignments.$inferSelect;
type AcceptanceRow = typeof browserGatewayAcceptanceRuns.$inferSelect;

function mapAssignment(row: AssignmentRow): BrowserGatewayAssignment {
  return BrowserGatewayAssignmentSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null
  });
}

function mapAcceptance(row: AcceptanceRow): BrowserGatewayAcceptanceRun {
  return AcceptanceInputSchema.parse({
    ...row,
    completedAt: row.completedAt.toISOString()
  });
}

function required<Row>(row: Row | undefined, message: string): Row {
  if (!row) throw new Error(message);
  return row;
}

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

export function createPostgresBrowserGatewayAssignmentRepository(
  connection: Pick<PostgresConnection, "db">
): BrowserGatewayAssignmentRepository {
  return {
    async createPending(input) {
      const assignment = BrowserGatewayAssignmentSchema.parse({
        ...input,
        status: "pending",
        activatedAt: null,
        revokedAt: null
      });
      const rows = await operation(() =>
        connection.db
          .insert(browserGatewayAssignments)
          .values({
            ...assignment,
            status: "pending",
            createdAt: new Date(assignment.createdAt),
            activatedAt: null,
            revokedAt: null
          })
          .returning()
      );
      return mapAssignment(required(rows[0], "Browser assignment insert returned no row."));
    },

    async activate(input) {
      const assignmentId = z.uuid().parse(input.assignmentId);
      const activatedAt = IsoDateTimeSchema.parse(input.activatedAt);
      const rows = await operation(() =>
        connection.db
          .update(browserGatewayAssignments)
          .set({ status: "active", activatedAt: new Date(activatedAt), revokedAt: null })
          .where(
            and(
              eq(browserGatewayAssignments.id, assignmentId),
              eq(browserGatewayAssignments.status, "pending")
            )
          )
          .returning()
      );
      return mapAssignment(required(rows[0], "Pending browser assignment was not found."));
    },

    async getActiveForUser(userIdInput) {
      const userId = VeraUserIdSchema.parse(userIdInput);
      const rows = await connection.db
        .select()
        .from(browserGatewayAssignments)
        .where(
          and(
            eq(browserGatewayAssignments.userId, userId),
            eq(browserGatewayAssignments.status, "active")
          )
        )
        .limit(1);
      return rows[0] ? mapAssignment(rows[0]) : null;
    },

    async getLatestForUser(userIdInput) {
      const userId = VeraUserIdSchema.parse(userIdInput);
      const rows = await connection.db
        .select()
        .from(browserGatewayAssignments)
        .where(eq(browserGatewayAssignments.userId, userId))
        .orderBy(desc(browserGatewayAssignments.createdAt))
        .limit(1);
      return rows[0] ? mapAssignment(rows[0]) : null;
    },

    async getActiveByCheckpointDigest(digestInput) {
      const digest =
        BrowserGatewayAssignmentSchema.shape.checkpointCredentialDigest.parse(digestInput);
      const rows = await connection.db
        .select()
        .from(browserGatewayAssignments)
        .where(
          and(
            eq(browserGatewayAssignments.checkpointCredentialDigest, digest),
            eq(browserGatewayAssignments.status, "active")
          )
        )
        .limit(1);
      return rows[0] ? mapAssignment(rows[0]) : null;
    },

    async listEnabledConnectorIdsForUser(userIdInput) {
      const userId = VeraUserIdSchema.parse(userIdInput);
      const rows = await connection.db
        .select({ connectorId: browserSourceControls.connectorId })
        .from(browserSourceControls)
        .where(
          and(eq(browserSourceControls.userId, userId), eq(browserSourceControls.enabled, true))
        )
        .orderBy(browserSourceControls.connectorId);
      return rows.map((row) => EntityIdSchema.parse(row.connectorId));
    },

    async revokeForUser(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const revokedAt = IsoDateTimeSchema.parse(input.revokedAt);
      return operation(() =>
        connection.db.transaction(async (transaction) => {
          const assignments = await transaction
            .select()
            .from(browserGatewayAssignments)
            .where(
              and(
                eq(browserGatewayAssignments.userId, userId),
                inArray(browserGatewayAssignments.status, ["pending", "active"])
              )
            )
            .for("update")
            .limit(1);
          const assignment = assignments[0];
          if (!assignment) return null;

          const instant = new Date(revokedAt);
          await transaction
            .update(browserUserControls)
            .set({ enabled: false, updatedAt: instant })
            .where(eq(browserUserControls.userId, userId));
          await transaction
            .update(browserSourceControls)
            .set({ enabled: false, updatedAt: instant })
            .where(eq(browserSourceControls.userId, userId));
          await transaction
            .update(browserProfileControls)
            .set({ disabledAt: instant, updatedAt: instant })
            .where(
              and(
                eq(browserProfileControls.userId, userId),
                eq(browserProfileControls.nodeId, assignment.nodeId)
              )
            );
          await transaction
            .update(browserNodes)
            .set({
              status: "revoked",
              pairingState: "revoked",
              capabilityApprovalState: "revoked",
              disabledAt: instant,
              updatedAt: instant
            })
            .where(
              and(eq(browserNodes.userId, userId), eq(browserNodes.nodeId, assignment.nodeId))
            );
          const rows = await transaction
            .update(browserGatewayAssignments)
            .set({ status: "revoked", revokedAt: instant })
            .where(
              and(
                eq(browserGatewayAssignments.id, assignment.id),
                eq(browserGatewayAssignments.userId, userId),
                inArray(browserGatewayAssignments.status, ["pending", "active"])
              )
            )
            .returning();
          return mapAssignment(required(rows[0], "Browser assignment revocation returned no row."));
        })
      );
    },

    async recordAcceptance(input) {
      const acceptance = AcceptanceInputSchema.parse(input);
      const rows = await connection.db
        .select({ id: browserGatewayAssignments.id })
        .from(browserGatewayAssignments)
        .where(
          and(
            eq(browserGatewayAssignments.id, acceptance.assignmentId),
            eq(browserGatewayAssignments.userId, acceptance.userId)
          )
        )
        .limit(1);
      if (!rows[0]) throw new Error("Browser acceptance assignment owner does not match.");
      const inserted = await operation(() =>
        connection.db
          .insert(browserGatewayAcceptanceRuns)
          .values({ ...acceptance, completedAt: new Date(acceptance.completedAt) })
          .returning()
      );
      return mapAcceptance(required(inserted[0], "Browser acceptance insert returned no row."));
    },

    async summarizeAcceptance() {
      const result = await connection.db.execute<{
        completed_runs: number;
        distinct_users: number;
        forbidden_action_count: number;
        unshare_passes: number;
        unpair_passes: number;
      }>(sql`
        select
          count(*)::int as completed_runs,
          count(distinct user_id)::int as distinct_users,
          coalesce(sum(forbidden_action_count), 0)::int as forbidden_action_count,
          count(*) filter (where unshare_stopped_future_work)::int as unshare_passes,
          count(*) filter (where unpair_verified)::int as unpair_passes
        from ${browserGatewayAcceptanceRuns}
      `);
      const row = required(result.rows[0], "Browser acceptance summary returned no row.");
      return {
        completedRuns: Number(row.completed_runs),
        distinctUsers: Number(row.distinct_users),
        forbiddenActionCount: Number(row.forbidden_action_count),
        unsharePasses: Number(row.unshare_passes),
        unpairPasses: Number(row.unpair_passes)
      };
    }
  };
}
