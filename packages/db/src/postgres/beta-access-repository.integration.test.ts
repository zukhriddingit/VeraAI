import { BETA_CONSENT_VERSION, type VeraUserId } from "@vera/domain";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createPostgresBetaAccessRepository } from "./beta-access-repository.ts";
import { betaMemberships, sessions, users } from "./schema.ts";
import { withPostgresTestDatabase } from "./testing.ts";

const founderId = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const testerId = "118f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const otherId = "218f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const now = new Date("2026-08-13T20:00:00.000Z");
const later = new Date("2026-08-13T20:05:00.000Z");

describe("PostgreSQL beta access repository", () => {
  it("stores one request for repeated normalized email", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const repository = createPostgresBetaAccessRepository(connection);
      const first = await repository.submit({
        email: "tester@example.com",
        consentVersion: BETA_CONSENT_VERSION,
        now
      });
      const repeated = await repository.submit({
        email: "TESTER@example.com",
        consentVersion: BETA_CONSENT_VERSION,
        now: later
      });
      expect(repeated.id).toBe(first.id);
      expect(repeated.requestedAt).toEqual(now);
      expect(await repository.listRequests("requested")).toHaveLength(1);
    });
  });

  it("invites and binds one verified identity atomically", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.insert(users).values([
        {
          id: founderId,
          name: "Founder",
          email: "founder@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now
        },
        {
          id: testerId,
          name: "Tester",
          email: "tester@example.com",
          emailVerified: true,
          createdAt: now,
          updatedAt: now
        },
        {
          id: otherId,
          name: "Other",
          email: "other@example.com",
          emailVerified: true,
          createdAt: now,
          updatedAt: now
        }
      ]);
      const repository = createPostgresBetaAccessRepository(connection);
      const request = await repository.submit({
        email: "tester@example.com",
        consentVersion: BETA_CONSENT_VERSION,
        now
      });
      await repository.review({
        requestId: request.id,
        action: "invite",
        reviewerUserId: founderId,
        now
      });
      const membership = await repository.activateInvitedUser({
        userId: testerId,
        now: later
      });
      expect(membership).toMatchObject({ userId: testerId, status: "active" });
      await expect(
        repository.bindInvitedMembership({
          email: "tester@example.com",
          userId: otherId,
          now: later
        })
      ).rejects.toThrow("Private beta access is required.");
    });
  });

  it("revokes membership and deletes every existing session", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.insert(users).values([
        {
          id: founderId,
          name: "Founder",
          email: "founder@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now
        },
        {
          id: testerId,
          name: "Tester",
          email: "tester@example.com",
          emailVerified: true,
          createdAt: now,
          updatedAt: now
        }
      ]);
      const repository = createPostgresBetaAccessRepository(connection);
      const request = await repository.submit({
        email: "tester@example.com",
        consentVersion: BETA_CONSENT_VERSION,
        now
      });
      await repository.review({
        requestId: request.id,
        action: "invite",
        reviewerUserId: founderId,
        now
      });
      const membership = await repository.bindInvitedMembership({
        email: "tester@example.com",
        userId: testerId,
        now
      });
      await db.insert(sessions).values({
        id: "318f9f64-7b5a-7c91-a12e-123456789abc",
        token: "test-session-token",
        userId: testerId,
        expiresAt: new Date("2026-08-14T20:00:00.000Z"),
        createdAt: now,
        updatedAt: now
      });

      await repository.revoke({
        membershipId: membership.id,
        reviewerUserId: founderId,
        now: later
      });
      expect(await repository.isActiveUser(testerId)).toBe(false);
      expect(await db.select().from(sessions).where(eq(sessions.userId, testerId))).toHaveLength(0);
      expect(
        (await db.select().from(betaMemberships).where(eq(betaMemberships.id, membership.id)))[0]
          ?.status
      ).toBe("revoked");
    });
  });

  it("enforces a short-lived opaque rate bucket", async () => {
    await withPostgresTestDatabase(async ({ connection }) => {
      const repository = createPostgresBetaAccessRepository(connection);
      const input = {
        keyDigest: "a".repeat(64),
        now,
        windowSeconds: 600,
        maximum: 2
      };
      await expect(repository.consumeRateLimit(input)).resolves.toBe(true);
      await expect(repository.consumeRateLimit(input)).resolves.toBe(true);
      await expect(repository.consumeRateLimit(input)).resolves.toBe(false);
    });
  });

  it("bootstraps only an existing verified user", async () => {
    await withPostgresTestDatabase(async ({ connection, db }) => {
      await db.insert(users).values({
        id: founderId,
        name: "Founder",
        email: "FOUNDER@example.test",
        emailVerified: true,
        createdAt: now,
        updatedAt: now
      });
      const repository = createPostgresBetaAccessRepository(connection);
      await expect(
        repository.bootstrapExistingUser({
          userId: founderId,
          approvedByUserId: founderId,
          now
        })
      ).resolves.toMatchObject({
        normalizedEmail: "founder@example.test",
        userId: founderId,
        status: "active"
      });
    });
  });
});
