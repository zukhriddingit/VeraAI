import type { PrivacyLifecycleService } from "../../../../lib/server/privacy-lifecycle-service.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearApplicationForTesting,
  registerApplication,
  type VeraApplication
} from "../../../../lib/server/application-registry.ts";
import { createUnconfiguredCalendarApplication } from "../../../../lib/server/unconfigured-calendar-application.ts";
import { DELETE as deletePrivacyAccount } from "./account/route.ts";
import { POST as requestDeletionChallenge } from "./deletion-request/route.ts";
import { GET as exportPrivacyData } from "./export/route.ts";

const origin = "https://app.verahousing.app";
const userId = "10000000-0000-4000-8000-000000000001";
const receiptId = "20000000-0000-4000-8000-000000000002";
const previousOrigin = process.env.VERA_PUBLIC_BASE_URL;

function registerFixture(
  options: {
    authenticated?: boolean;
    setCookies?: readonly string[];
    deletionFailure?: boolean;
  } = {}
) {
  const exportOwner = vi.fn(async () => new TextEncoder().encode('{"type":"manifest"}\n'));
  const issueDeletionChallenge = vi.fn(async () => ({
    challengeToken: "a".repeat(43),
    expiresAt: "2026-08-16T12:15:00.000Z"
  }));
  const deleteOwner = vi.fn(async () => {
    if (options.deletionFailure) throw new Error("delete failed");
    return {
      id: receiptId,
      formerUserId: userId,
      subjectDigest: "b".repeat(64),
      providerRevocation: "confirmed" as const,
      browserRevocation: "confirmed" as const,
      completedAt: "2026-08-16T12:00:00.000Z",
      backupEraseAfter: "2026-09-15T12:00:00.000Z",
      legalHoldUntil: null
    };
  });
  const signOut = vi.fn(async () => {
    const response = Response.json({ success: true });
    for (const cookie of options.setCookies ?? []) response.headers.append("Set-Cookie", cookie);
    return response;
  });
  const privacyLifecycle = {
    exportOwner,
    issueDeletionChallenge,
    deleteOwner
  } satisfies PrivacyLifecycleService;
  const application: VeraApplication = {
    mode: "hosted",
    repositoryProvider: {
      forUser: vi.fn(() => ({ activityEvents: { append: vi.fn() } }))
    } as unknown as VeraApplication["repositoryProvider"],
    auth: {
      api: {
        getSession: vi.fn(async () =>
          options.authenticated === false
            ? null
            : { user: { id: userId }, session: { id: "session-test" } }
        ),
        signOut
      }
    } as unknown as VeraApplication["auth"],
    calendar: createUnconfiguredCalendarApplication(),
    gmailOAuth: null,
    betaAccess: null,
    browserConnectorEnrollments: null,
    browserGatewayAssignments: null,
    browserGatewayRuntime: null,
    privacyLifecycle,
    demoUserId: null,
    readiness: vi.fn(),
    close: vi.fn()
  };
  registerApplication(application);
  return { deleteOwner, exportOwner, issueDeletionChallenge, signOut };
}

function mutationRequest(body: string, requestOrigin = origin): Request {
  return new Request(`${origin}/api/settings/privacy/deletion-request`, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body
  });
}

function accountDeletionRequest(body: string, requestOrigin = origin): Request {
  return new Request(`${origin}/api/settings/privacy/account`, {
    method: "DELETE",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body
  });
}

beforeEach(() => {
  process.env.VERA_PUBLIC_BASE_URL = origin;
});

afterEach(() => {
  clearApplicationForTesting();
  if (previousOrigin === undefined) delete process.env.VERA_PUBLIC_BASE_URL;
  else process.env.VERA_PUBLIC_BASE_URL = previousOrigin;
});

describe("privacy routes", () => {
  it("exports only the authenticated owner as a non-cacheable NDJSON attachment", async () => {
    const fixture = registerFixture();
    const response = await exportPrivacyData(new Request(`${origin}/api/settings/privacy/export`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("vera-data-export.ndjson");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fixture.exportOwner).toHaveBeenCalledWith(
      expect.objectContaining({ userId, generatedAt: expect.any(String) })
    );
  });

  it("rejects unauthenticated export before calling the privacy service", async () => {
    const fixture = registerFixture({ authenticated: false });
    const response = await exportPrivacyData(new Request(`${origin}/api/settings/privacy/export`));
    expect(response.status).toBe(401);
    expect(fixture.exportOwner).not.toHaveBeenCalled();
  });

  it("issues a strict owner-bound challenge without auditing or accepting an owner id", async () => {
    const fixture = registerFixture();
    const response = await requestDeletionChallenge(
      mutationRequest(JSON.stringify({ confirmation: "request_account_deletion" }))
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      challengeToken: "a".repeat(43),
      expiresAt: "2026-08-16T12:15:00.000Z"
    });
    expect(fixture.issueDeletionChallenge).toHaveBeenCalledWith({
      userId,
      now: expect.any(Date)
    });

    clearApplicationForTesting();
    registerFixture();
    const withOwner = await requestDeletionChallenge(
      mutationRequest(
        JSON.stringify({ confirmation: "request_account_deletion", userId: "someone-else" })
      )
    );
    expect(withOwner.status).toBe(400);
  });

  it("checks exact origin and body bounds before issuing a challenge", async () => {
    const fixture = registerFixture();
    const crossOrigin = await requestDeletionChallenge(
      mutationRequest(
        JSON.stringify({ confirmation: "request_account_deletion" }),
        "https://evil.test"
      )
    );
    expect(crossOrigin.status).toBe(403);
    expect(fixture.issueDeletionChallenge).not.toHaveBeenCalled();

    const oversized = await requestDeletionChallenge(
      mutationRequest(JSON.stringify({ confirmation: "x".repeat(600) }))
    );
    expect(oversized.status).toBe(413);
    expect(fixture.issueDeletionChallenge).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, cross-origin, malformed, and oversized account deletion", async () => {
    let fixture = registerFixture({ authenticated: false });
    const unauthenticated = await deletePrivacyAccount(
      accountDeletionRequest(
        JSON.stringify({ challengeToken: "a".repeat(43), confirmation: "DELETE MY VERA ACCOUNT" })
      )
    );
    expect(unauthenticated.status).toBe(401);
    expect(fixture.deleteOwner).not.toHaveBeenCalled();

    clearApplicationForTesting();
    fixture = registerFixture();
    const crossOrigin = await deletePrivacyAccount(
      accountDeletionRequest(
        JSON.stringify({ challengeToken: "a".repeat(43), confirmation: "DELETE MY VERA ACCOUNT" }),
        "https://evil.test"
      )
    );
    expect(crossOrigin.status).toBe(403);
    expect(fixture.deleteOwner).not.toHaveBeenCalled();

    const malformed = await deletePrivacyAccount(accountDeletionRequest("{"));
    expect(malformed.status).toBe(400);
    const wrongConfirmation = await deletePrivacyAccount(
      accountDeletionRequest(
        JSON.stringify({ challengeToken: "a".repeat(43), confirmation: "delete my account" })
      )
    );
    expect(wrongConfirmation.status).toBe(400);
    const oversized = await deletePrivacyAccount(
      accountDeletionRequest(
        JSON.stringify({
          challengeToken: "a".repeat(43),
          confirmation: "DELETE MY VERA ACCOUNT",
          padding: "x".repeat(1_024)
        })
      )
    );
    expect(oversized.status).toBe(413);
    expect(fixture.deleteOwner).not.toHaveBeenCalled();
  });

  it.each([
    [
      "development",
      [
        "vera.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
        "vera.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
        "vera.dont_remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
      ]
    ],
    [
      "production",
      [
        "__Secure-vera.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
        "__Secure-vera.session_data=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
        "__Secure-vera.dont_remember=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"
      ]
    ]
  ])(
    "deletes only the session owner and forwards all %s sign-out cookies",
    async (_mode, cookies) => {
      const fixture = registerFixture({ setCookies: cookies });
      const response = await deletePrivacyAccount(
        accountDeletionRequest(
          JSON.stringify({ challengeToken: "a".repeat(43), confirmation: "DELETE MY VERA ACCOUNT" })
        )
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "deleted", receiptId });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.getSetCookie()).toEqual(cookies);
      expect(fixture.deleteOwner).toHaveBeenCalledWith({
        userId,
        challengeToken: "a".repeat(43),
        confirmation: "DELETE MY VERA ACCOUNT",
        now: expect.any(Date)
      });
      expect(fixture.signOut).toHaveBeenCalledWith({
        headers: expect.any(Headers),
        asResponse: true
      });
    }
  );

  it("returns a typed 503 and no sign-out cookies when deletion fails", async () => {
    const fixture = registerFixture({ deletionFailure: true });
    const response = await deletePrivacyAccount(
      accountDeletionRequest(
        JSON.stringify({ challengeToken: "a".repeat(43), confirmation: "DELETE MY VERA ACCOUNT" })
      )
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "deletion_failed",
      message: "Account deletion could not be completed."
    });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(fixture.signOut).not.toHaveBeenCalled();
  });
});
