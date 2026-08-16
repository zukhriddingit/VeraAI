import { createHmac, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

import {
  PRIVACY_DELETION_CHALLENGE_TTL_MILLISECONDS,
  PrivacyDeletionRequestSchema,
  VeraUserIdSchema,
  serializePrivacyExportNdjson
} from "@vera/domain";
import type {
  PRIVACY_DELETION_CONFIRMATION,
  PrivacyDeletionReceipt,
  VeraUserId
} from "@vera/domain";
import {
  sha256Text,
  type BrowserConnectorEnrollmentRepository,
  type BrowserGatewayAssignmentRepository,
  type PrivacyLifecycleRepository
} from "@vera/db";

import {
  GoogleIntegrationOAuthError,
  type GoogleIntegrationOAuth
} from "./google-integration-oauth.ts";
import type { PrivacyEnvironment } from "./privacy-config.ts";

export interface PrivacyLifecycleService {
  exportOwner(input: { userId: VeraUserId; generatedAt: string }): Promise<Uint8Array>;
  issueDeletionChallenge(input: { userId: VeraUserId; now: Date }): Promise<{
    challengeToken: string;
    expiresAt: string;
  }>;
  deleteOwner(input: {
    userId: VeraUserId;
    challengeToken: string;
    confirmation: typeof PRIVACY_DELETION_CONFIRMATION;
    now: Date;
  }): Promise<PrivacyDeletionReceipt>;
}

export interface PrivacyLifecycleServiceDependencies {
  readonly repository: PrivacyLifecycleRepository;
  readonly browserGatewayAssignments: BrowserGatewayAssignmentRepository | null;
  readonly browserConnectorEnrollments: BrowserConnectorEnrollmentRepository | null;
  readonly googleOAuth: GoogleIntegrationOAuth | null;
  readonly configuration: PrivacyEnvironment;
  readonly randomBytes?: (size: number) => Buffer;
  readonly randomId?: () => string;
}

export function createPrivacyLifecycleService(
  dependencies: PrivacyLifecycleServiceDependencies
): PrivacyLifecycleService {
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const randomId = dependencies.randomId ?? randomUUID;

  return {
    async exportOwner(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const bundle = await dependencies.repository.exportOwner({
        userId,
        generatedAt: input.generatedAt
      });
      return serializePrivacyExportNdjson([bundle.manifest, ...bundle.records]);
    },

    async issueDeletionChallenge(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const challengeBytes = randomBytes(32);
      let challengeToken = challengeBytes.toString("base64url");
      try {
        const expiresAt = new Date(
          input.now.getTime() + PRIVACY_DELETION_CHALLENGE_TTL_MILLISECONDS
        ).toISOString();
        await dependencies.repository.issueDeletionChallenge({
          id: randomId(),
          userId,
          challengeDigest: sha256Text(challengeToken),
          createdAt: input.now.toISOString(),
          expiresAt
        });
        return { challengeToken, expiresAt };
      } finally {
        challengeBytes.fill(0);
        challengeToken = "";
      }
    },

    async deleteOwner(input) {
      const parsed = PrivacyDeletionRequestSchema.parse({
        challengeToken: input.challengeToken,
        confirmation: input.confirmation
      });
      const userId = VeraUserIdSchema.parse(input.userId);
      const timestamp = input.now.toISOString();
      const challengeDigest = sha256Text(parsed.challengeToken);
      let providerSubject = "";
      try {
        const consumedChallengeId = await dependencies.repository.consumeDeletionChallenge({
          userId,
          challengeDigest,
          consumedAt: timestamp
        });
        const identity = await dependencies.repository.getDeletionIdentity(userId);
        providerSubject = identity.providerSubject;

        let browserRevocation: "not_configured" | "confirmed" = "not_configured";
        const assignments = dependencies.browserGatewayAssignments;
        const enrollments = dependencies.browserConnectorEnrollments;
        if ((assignments === null) !== (enrollments === null)) {
          throw new Error("Browser privacy revocation dependencies are incomplete.");
        }
        if (assignments !== null && enrollments !== null) {
          await assignments.revokeForUser({ userId, revokedAt: timestamp });
          await enrollments.revokeForUser({ userId, revokedAt: timestamp });
          browserRevocation = "confirmed";
        }

        let providerRevocation: "not_configured" | "confirmed" | "unconfirmed" = "not_configured";
        if (dependencies.googleOAuth !== null) {
          try {
            await dependencies.googleOAuth.disconnect({ userId });
            providerRevocation = "confirmed";
          } catch (error: unknown) {
            if (
              error instanceof GoogleIntegrationOAuthError &&
              error.code === "provider_revocation_unconfirmed"
            ) {
              providerRevocation = "unconfirmed";
            } else {
              throw error;
            }
          }
        }

        const subjectDigest = createHmac("sha256", dependencies.configuration.subjectHmacKey)
          .update(`vera-privacy-subject:v1:${providerSubject}`)
          .digest("hex");
        const backupEraseAfter = new Date(
          input.now.getTime() + dependencies.configuration.backupRetentionDays * 86_400_000
        ).toISOString();
        return dependencies.repository.deleteOwnerAccount({
          userId,
          consumedChallengeId,
          subjectDigest,
          providerRevocation,
          browserRevocation,
          completedAt: timestamp,
          backupEraseAfter,
          legalHoldUntil: null
        });
      } finally {
        providerSubject = "";
      }
    }
  };
}
