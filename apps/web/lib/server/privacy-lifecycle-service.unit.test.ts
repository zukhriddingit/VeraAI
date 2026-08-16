import type { PrivacyDeletionReceipt, PrivacyExportManifest } from "@vera/domain";
import type {
  BrowserConnectorEnrollmentRepository,
  BrowserGatewayAssignmentRepository,
  PrivacyLifecycleRepository
} from "@vera/db";
import { describe, expect, it, vi } from "vitest";

import {
  GoogleIntegrationOAuthError,
  type GoogleIntegrationOAuth
} from "./google-integration-oauth.ts";
import { createPrivacyLifecycleService } from "./privacy-lifecycle-service.ts";

const userId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-08-16T12:00:00.000Z");
const receipt: PrivacyDeletionReceipt = {
  id: "20000000-0000-4000-8000-000000000002",
  formerUserId: userId,
  subjectDigest: "a".repeat(64),
  providerRevocation: "confirmed",
  browserRevocation: "confirmed",
  completedAt: now.toISOString(),
  backupEraseAfter: "2026-09-15T12:00:00.000Z",
  legalHoldUntil: null
};

function fixture(
  options: {
    providerError?: Error;
    configuredBrowser?: boolean;
    configuredGoogle?: boolean;
    preDeleteError?: Error;
  } = {}
) {
  const calls: string[] = [];
  const deleteOwnerAccount = vi.fn(
    async (_input: Parameters<PrivacyLifecycleRepository["deleteOwnerAccount"]>[0]) => receipt
  );
  const manifest: PrivacyExportManifest = {
    type: "manifest",
    schemaVersion: "vera-privacy-export.v1",
    userId,
    generatedAt: now.toISOString(),
    recordCounts: { users: 0 },
    recordHashes: { users: "0".repeat(64) },
    warning:
      "This export excludes passwords, sessions, OAuth tokens, browser credentials, and internal security material."
  };
  const repository = {
    exportOwner: vi.fn(async () => ({ manifest, records: [] })),
    issueDeletionChallenge: vi.fn(async (input) => ({ ...input, consumedAt: null })),
    consumeDeletionChallenge: vi.fn(async () => {
      calls.push("consume_challenge");
      return "30000000-0000-4000-8000-000000000003";
    }),
    getDeletionIdentity: vi.fn(async () => {
      calls.push("load_identity");
      if (options.preDeleteError) throw options.preDeleteError;
      return { normalizedEmail: "owner@example.test", providerSubject: "google-subject" };
    }),
    deleteOwnerAccount: vi.fn(async (input) => {
      calls.push("delete_owner");
      return deleteOwnerAccount(input);
    }),
    reapplyDeletionReceipt: vi.fn(),
    countOwnerRows: vi.fn()
  } satisfies PrivacyLifecycleRepository;
  const assignments = {
    revokeForUser: vi.fn(async () => {
      calls.push("revoke_assignment");
      return null;
    })
  } as unknown as BrowserGatewayAssignmentRepository;
  const enrollments = {
    revokeForUser: vi.fn(async () => {
      calls.push("revoke_enrollments");
      return 0;
    })
  } as unknown as BrowserConnectorEnrollmentRepository;
  const googleOAuth = {
    disconnect: vi.fn(async () => {
      calls.push("disconnect_google");
      if (options.providerError) throw options.providerError;
    })
  } as unknown as GoogleIntegrationOAuth;
  const service = createPrivacyLifecycleService({
    repository,
    browserGatewayAssignments: options.configuredBrowser === false ? null : assignments,
    browserConnectorEnrollments: options.configuredBrowser === false ? null : enrollments,
    googleOAuth: options.configuredGoogle === false ? null : googleOAuth,
    configuration: { subjectHmacKey: "k".repeat(32), backupRetentionDays: 30 },
    randomBytes: () => Buffer.alloc(32, 7),
    randomId: () => "40000000-0000-4000-8000-000000000004"
  });
  return { service, calls, repository, deleteOwnerAccount };
}

describe("privacy lifecycle service", () => {
  it("persists only a digest for a bounded one-time challenge", async () => {
    const { service, repository } = fixture();
    await expect(service.issueDeletionChallenge({ userId, now })).resolves.toMatchObject({
      challengeToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      expiresAt: "2026-08-16T12:15:00.000Z"
    });
    expect(repository.issueDeletionChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ challengeDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    );
    expect(JSON.stringify(vi.mocked(repository.issueDeletionChallenge).mock.calls)).not.toContain(
      Buffer.alloc(32, 7).toString("base64url")
    );
  });

  it("revokes browser and Google access before owner deletion", async () => {
    const { service, calls, deleteOwnerAccount } = fixture();
    await service.deleteOwner({
      userId,
      challengeToken: "a".repeat(43),
      confirmation: "DELETE MY VERA ACCOUNT",
      now
    });
    expect(calls).toEqual([
      "consume_challenge",
      "load_identity",
      "revoke_assignment",
      "revoke_enrollments",
      "disconnect_google",
      "delete_owner"
    ]);
    expect(deleteOwnerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRevocation: "confirmed",
        browserRevocation: "confirmed",
        backupEraseAfter: "2026-09-15T12:00:00.000Z"
      })
    );
  });

  it("continues after an unconfirmed provider revocation but not other pre-delete failures", async () => {
    const unconfirmed = fixture({
      providerError: new GoogleIntegrationOAuthError("provider_revocation_unconfirmed", 503)
    });
    await unconfirmed.service.deleteOwner({
      userId,
      challengeToken: "a".repeat(43),
      confirmation: "DELETE MY VERA ACCOUNT",
      now
    });
    expect(unconfirmed.deleteOwnerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ providerRevocation: "unconfirmed" })
    );

    const failed = fixture({ preDeleteError: new Error("identity unavailable") });
    await expect(
      failed.service.deleteOwner({
        userId,
        challengeToken: "a".repeat(43),
        confirmation: "DELETE MY VERA ACCOUNT",
        now
      })
    ).rejects.toThrow("identity unavailable");
    expect(failed.deleteOwnerAccount).not.toHaveBeenCalled();
  });

  it("records unconfigured external boundaries without pretending to revoke them", async () => {
    const { service, deleteOwnerAccount } = fixture({
      configuredBrowser: false,
      configuredGoogle: false
    });
    await service.deleteOwner({
      userId,
      challengeToken: "a".repeat(43),
      confirmation: "DELETE MY VERA ACCOUNT",
      now
    });
    expect(deleteOwnerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRevocation: "not_configured",
        browserRevocation: "not_configured"
      })
    );
  });
});
