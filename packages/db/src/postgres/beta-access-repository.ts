import {
  BETA_CONSENT_VERSION,
  BetaAccessRequestStatusSchema,
  BetaMembershipStatusSchema,
  VeraUserIdSchema,
  normalizeBetaEmail,
  type BetaAccessRequest,
  type BetaAccessRequestStatus,
  type BetaAccessReviewAction,
  type BetaMembership,
  type VeraUserId
} from "@vera/domain";
import { and, desc, eq, sql } from "drizzle-orm";

import type { PostgresConnection } from "./connection.ts";
import {
  betaAccessRateLimits,
  betaAccessRequests,
  betaMemberships,
  sessions,
  users
} from "./schema.ts";

export interface BetaAccessRepository {
  submit(input: {
    readonly email: string;
    readonly consentVersion: string;
    readonly now: Date;
  }): Promise<BetaAccessRequest>;
  consumeRateLimit(input: {
    readonly keyDigest: string;
    readonly now: Date;
    readonly windowSeconds: number;
    readonly maximum: number;
  }): Promise<boolean>;
  listRequests(status?: BetaAccessRequestStatus): Promise<readonly BetaAccessRequest[]>;
  review(input: {
    readonly requestId: string;
    readonly action: BetaAccessReviewAction;
    readonly reviewerUserId: VeraUserId;
    readonly now: Date;
  }): Promise<BetaAccessRequest>;
  findInvitedByEmail(email: string): Promise<BetaMembership | null>;
  isActiveUser(userId: VeraUserId): Promise<boolean>;
  activateInvitedUser(input: {
    readonly userId: VeraUserId;
    readonly now: Date;
  }): Promise<BetaMembership>;
  bindInvitedMembership(input: {
    readonly email: string;
    readonly userId: VeraUserId;
    readonly now: Date;
  }): Promise<BetaMembership>;
  revoke(input: {
    readonly membershipId: string;
    readonly reviewerUserId: VeraUserId;
    readonly now: Date;
  }): Promise<BetaMembership>;
  bootstrapExistingUser(input: {
    readonly userId: VeraUserId;
    readonly approvedByUserId: VeraUserId;
    readonly now: Date;
  }): Promise<BetaMembership>;
}

type RequestRow = typeof betaAccessRequests.$inferSelect;
type MembershipRow = typeof betaMemberships.$inferSelect;

function requestFromRow(row: RequestRow): BetaAccessRequest {
  const status = BetaAccessRequestStatusSchema.parse(row.status);
  if (row.consentVersion !== BETA_CONSENT_VERSION) {
    throw new Error("The persisted beta consent version is unsupported.");
  }
  return {
    id: row.id,
    normalizedEmail: row.normalizedEmail,
    status,
    consentVersion: row.consentVersion,
    consentedAt: row.consentedAt,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    reviewedByUserId: row.reviewedByUserId ? VeraUserIdSchema.parse(row.reviewedByUserId) : null
  };
}

function membershipFromRow(row: MembershipRow): BetaMembership {
  return {
    id: row.id,
    normalizedEmail: row.normalizedEmail,
    userId: row.userId ? VeraUserIdSchema.parse(row.userId) : null,
    status: BetaMembershipStatusSchema.parse(row.status),
    invitedAt: row.invitedAt,
    activatedAt: row.activatedAt,
    revokedAt: row.revokedAt,
    approvedByUserId: row.approvedByUserId ? VeraUserIdSchema.parse(row.approvedByUserId) : null
  };
}

function required<Row>(row: Row | undefined, message: string): Row {
  if (!row) throw new Error(message);
  return row;
}

function reviewStatus(action: BetaAccessReviewAction): BetaAccessRequestStatus {
  if (action === "invite") return "invited";
  return action === "decline" ? "declined" : "withdrawn";
}

export function createPostgresBetaAccessRepository(
  connection: Pick<PostgresConnection, "db">
): BetaAccessRepository {
  return {
    async submit(input) {
      const normalizedEmail = normalizeBetaEmail(input.email);
      if (input.consentVersion !== BETA_CONSENT_VERSION) {
        throw new Error("The beta consent version is unsupported.");
      }
      const rows = await connection.db
        .insert(betaAccessRequests)
        .values({
          normalizedEmail,
          status: "requested",
          consentVersion: BETA_CONSENT_VERSION,
          consentedAt: input.now,
          requestedAt: input.now
        })
        .onConflictDoUpdate({
          target: betaAccessRequests.normalizedEmail,
          set: { normalizedEmail: sql`excluded.normalized_email` }
        })
        .returning();
      return requestFromRow(required(rows[0], "Beta request insert returned no row."));
    },

    async consumeRateLimit(input) {
      if (!/^[a-f0-9]{64}$/u.test(input.keyDigest)) {
        throw new Error("Beta rate-limit digest is invalid.");
      }
      if (input.windowSeconds < 1 || input.maximum < 1) {
        throw new Error("Beta rate-limit bounds are invalid.");
      }
      const expiresAt = new Date(input.now.getTime() + input.windowSeconds * 1_000);
      return connection.db.transaction(async (transaction) => {
        await transaction.execute(sql`
          delete from ${betaAccessRateLimits}
          where ${betaAccessRateLimits.keyDigest} in (
            select ${betaAccessRateLimits.keyDigest}
            from ${betaAccessRateLimits}
            where ${betaAccessRateLimits.expiresAt} < ${input.now}
            order by ${betaAccessRateLimits.expiresAt}
            limit 100
          )
        `);
        const rows = await transaction
          .insert(betaAccessRateLimits)
          .values({
            keyDigest: input.keyDigest,
            windowStartedAt: input.now,
            attempts: 1,
            expiresAt
          })
          .onConflictDoUpdate({
            target: betaAccessRateLimits.keyDigest,
            set: {
              attempts: sql`CASE WHEN ${betaAccessRateLimits.expiresAt} < ${input.now} THEN 1 ELSE ${betaAccessRateLimits.attempts} + 1 END`,
              windowStartedAt: sql`CASE WHEN ${betaAccessRateLimits.expiresAt} < ${input.now} THEN ${input.now} ELSE ${betaAccessRateLimits.windowStartedAt} END`,
              expiresAt: sql`CASE WHEN ${betaAccessRateLimits.expiresAt} < ${input.now} THEN ${expiresAt} ELSE ${betaAccessRateLimits.expiresAt} END`
            }
          })
          .returning({ attempts: betaAccessRateLimits.attempts });
        return Number(required(rows[0], "Beta rate-limit operation returned no row.").attempts) <= input.maximum;
      });
    },

    async listRequests(status) {
      const query = connection.db.select().from(betaAccessRequests);
      const rows = status
        ? await query
            .where(eq(betaAccessRequests.status, BetaAccessRequestStatusSchema.parse(status)))
            .orderBy(desc(betaAccessRequests.requestedAt))
        : await query.orderBy(desc(betaAccessRequests.requestedAt));
      return rows.map(requestFromRow);
    },

    async review(input) {
      const status = reviewStatus(input.action);
      return connection.db.transaction(async (transaction) => {
        const currentRows = await transaction
          .select()
          .from(betaAccessRequests)
          .where(eq(betaAccessRequests.id, input.requestId))
          .limit(1)
          .for("update");
        const current = required(currentRows[0], "Beta access request was not found.");
        if (current.status !== "requested" && current.status !== status) {
          throw new Error("The beta access request already has a conflicting decision.");
        }
        const reviewedRows = await transaction
          .update(betaAccessRequests)
          .set({
            status,
            reviewedAt: current.reviewedAt ?? input.now,
            reviewedByUserId: current.reviewedByUserId ?? input.reviewerUserId
          })
          .where(eq(betaAccessRequests.id, input.requestId))
          .returning();

        if (status === "invited") {
          await transaction
            .insert(betaMemberships)
            .values({
              normalizedEmail: current.normalizedEmail,
              status: "invited",
              invitedAt: input.now,
              approvedByUserId: input.reviewerUserId
            })
            .onConflictDoUpdate({
              target: betaMemberships.normalizedEmail,
              set: {
                status: sql`CASE WHEN ${betaMemberships.status} = 'revoked' THEN ${betaMemberships.status} ELSE 'invited' END`,
                approvedByUserId: input.reviewerUserId
              }
            });
        }
        return requestFromRow(required(reviewedRows[0], "Beta review returned no row."));
      });
    },

    async findInvitedByEmail(email) {
      const rows = await connection.db
        .select()
        .from(betaMemberships)
        .where(
          and(
            eq(betaMemberships.normalizedEmail, normalizeBetaEmail(email)),
            eq(betaMemberships.status, "invited")
          )
        )
        .limit(1);
      return rows[0] ? membershipFromRow(rows[0]) : null;
    },

    async isActiveUser(userId) {
      const rows = await connection.db
        .select({ id: betaMemberships.id })
        .from(betaMemberships)
        .where(
          and(
            eq(betaMemberships.userId, VeraUserIdSchema.parse(userId)),
            eq(betaMemberships.status, "active")
          )
        )
        .limit(1);
      return rows.length === 1;
    },

    async activateInvitedUser(input) {
      return connection.db.transaction(async (transaction) => {
        const userRows = await transaction
          .select({ email: users.email, emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.id, VeraUserIdSchema.parse(input.userId)))
          .limit(1)
          .for("update");
        const user = required(userRows[0], "Private beta access is required.");
        if (!user.emailVerified) throw new Error("Private beta access is required.");
        const rows = await transaction
          .select()
          .from(betaMemberships)
          .where(eq(betaMemberships.normalizedEmail, normalizeBetaEmail(user.email)))
          .limit(1)
          .for("update");
        const current = required(rows[0], "Private beta access is required.");
        if (current.status === "active" && current.userId === input.userId) {
          return membershipFromRow(current);
        }
        if (current.status !== "invited" || current.userId !== null) {
          throw new Error("Private beta access is required.");
        }
        const updated = await transaction
          .update(betaMemberships)
          .set({
            userId: input.userId,
            status: "active",
            activatedAt: input.now,
            revokedAt: null
          })
          .where(eq(betaMemberships.id, current.id))
          .returning();
        return membershipFromRow(required(updated[0], "Beta membership activation returned no row."));
      });
    },

    async bindInvitedMembership(input) {
      return connection.db.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(betaMemberships)
          .where(eq(betaMemberships.normalizedEmail, normalizeBetaEmail(input.email)))
          .limit(1)
          .for("update");
        const current = required(rows[0], "Private beta access is required.");
        if (current.status === "active" && current.userId === input.userId) {
          return membershipFromRow(current);
        }
        if (current.status !== "invited" || current.userId !== null) {
          throw new Error("Private beta access is required.");
        }
        const updated = await transaction
          .update(betaMemberships)
          .set({ userId: input.userId, status: "active", activatedAt: input.now, revokedAt: null })
          .where(eq(betaMemberships.id, current.id))
          .returning();
        return membershipFromRow(required(updated[0], "Beta membership binding returned no row."));
      });
    },

    async revoke(input) {
      return connection.db.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(betaMemberships)
          .where(eq(betaMemberships.id, input.membershipId))
          .limit(1)
          .for("update");
        const current = required(rows[0], "Beta membership was not found.");
        const updated = await transaction
          .update(betaMemberships)
          .set({
            status: "revoked",
            revokedAt: current.revokedAt ?? input.now,
            approvedByUserId: input.reviewerUserId
          })
          .where(eq(betaMemberships.id, current.id))
          .returning();
        if (current.userId) {
          await transaction.delete(sessions).where(eq(sessions.userId, current.userId));
        }
        return membershipFromRow(required(updated[0], "Beta membership revocation returned no row."));
      });
    },

    async bootstrapExistingUser(input) {
      return connection.db.transaction(async (transaction) => {
        const userRows = await transaction
          .select({ email: users.email, emailVerified: users.emailVerified })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
          .for("update");
        const user = required(userRows[0], "The founder user does not exist.");
        if (!user.emailVerified) throw new Error("The founder email must already be verified.");
        const normalizedEmail = normalizeBetaEmail(user.email);
        const rows = await transaction
          .insert(betaMemberships)
          .values({
            normalizedEmail,
            userId: input.userId,
            status: "active",
            invitedAt: input.now,
            activatedAt: input.now,
            approvedByUserId: input.approvedByUserId
          })
          .onConflictDoUpdate({
            target: betaMemberships.normalizedEmail,
            set: {
              userId: input.userId,
              status: "active",
              activatedAt: input.now,
              revokedAt: null,
              approvedByUserId: input.approvedByUserId
            }
          })
          .returning();
        return membershipFromRow(required(rows[0], "Founder bootstrap returned no row."));
      });
    }
  };
}
