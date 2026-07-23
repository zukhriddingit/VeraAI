import type { CalendarCapability } from "@vera/domain";
import { decryptCredential } from "@vera/db";
import { describe, expect, it } from "vitest";

import { GoogleOAuthProviderError } from "./google-integration-oauth.ts";
import {
  FIXED_VERA_USER_ID,
  callbackFixture,
  createOAuthFixture,
  runCallback
} from "./google-integration-oauth.test-fixtures.ts";

async function authorize(
  fixture: ReturnType<typeof createOAuthFixture>,
  capability: CalendarCapability = "calendar_conflict_checking"
) {
  const result = await fixture.oauth.createAuthorization({
    userId: FIXED_VERA_USER_ID,
    capability,
    returnTo: "/settings/integrations"
  });
  return new URL(result.authorizationUrl).searchParams.get("state") ?? "";
}

describe("incremental Google integration OAuth", () => {
  it.each(["state_mismatch", "expired_state", "wrong_vera_user", "reused_state"] as const)(
    "rejects %s without a second code exchange",
    async (failure) => {
      const result = await runCallback(callbackFixture(failure));
      expect(result.response.status).toBe(400);
      expect(result.codeExchangeCalls).toBe(failure === "reused_state" ? 1 : 0);
    }
  );

  it("requests identity plus exactly one capability scope with S256 PKCE", async () => {
    const fixture = createOAuthFixture();
    await authorize(fixture, "calendar_conflict_checking");
    await authorize(fixture, "calendar_hold_creation");

    expect(fixture.transport.authorizationCalls[0]).toMatchObject({
      scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy"],
      prompt: "consent"
    });
    expect(fixture.transport.authorizationCalls[1]).toMatchObject({
      scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.events.owned"]
    });
    expect(fixture.transport.authorizationCalls[0]?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it("rejects a provider authorization URL that changes the trusted redirect binding", async () => {
    const fixture = createOAuthFixture();
    fixture.transport.createAuthorizationUrl = (input) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", fixture.configuration.clientId);
      url.searchParams.set("redirect_uri", "https://attacker.example.test/callback");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", input.state);
      url.searchParams.set("scope", input.scopes.join(" "));
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("include_granted_scopes", "true");
      return url.href;
    };

    await expect(authorize(fixture)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fixture.states.size).toBe(0);
  });

  it("persists actual partial grants rather than requested scopes", async () => {
    const result = await runCallback(callbackFixture("partial_grant"));
    expect(result.connection?.grantedScopes).toEqual(["email", "openid"]);
    expect(result.connection?.status).toBe("partial");
  });

  it("fails closed if Google returns a broader Calendar grant than Vera supports", async () => {
    const fixture = createOAuthFixture();
    fixture.transport.tokenInfo = {
      ...fixture.transport.tokenInfo,
      scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar"]
    } as never;
    const state = await authorize(fixture);
    await expect(
      fixture.oauth.handleCallback({
        userId: FIXED_VERA_USER_ID,
        state,
        code: "synthetic-code"
      })
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fixture.connections.size).toBe(0);
  });

  it("encrypts both the PKCE verifier and refresh token at rest", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    const persistedState = [...fixture.states.values()][0];
    const connection = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    const verifier = fixture.transport.exchangeCalls[0]?.codeVerifier ?? "";
    expect(verifier).not.toBe("");
    expect(JSON.stringify(persistedState)).not.toContain(verifier);
    await expect(
      decryptCredential(
        persistedState!.encryptedPkceVerifier,
        {
          userId: FIXED_VERA_USER_ID,
          integrationId: persistedState!.id,
          provider: "google"
        },
        fixture.configuration.credentialKeyProvider
      )
    ).resolves.toBe(verifier);
    expect(JSON.stringify(connection)).not.toContain("synthetic-refresh-token");
    await expect(
      decryptCredential(
        connection.encryptedRefreshToken!,
        { userId: FIXED_VERA_USER_ID, integrationId: connection.id, provider: "google" },
        fixture.configuration.credentialKeyProvider
      )
    ).resolves.toBe("synthetic-refresh-token");
  });

  it("marks a first connection without refresh material reconnect-required", async () => {
    const fixture = createOAuthFixture();
    fixture.transport.tokenSet = { ...fixture.transport.tokenSet, refreshToken: null } as never;
    const state = await authorize(fixture);
    await expect(
      fixture.oauth.handleCallback({
        userId: FIXED_VERA_USER_ID,
        state,
        code: "synthetic-code"
      })
    ).resolves.toMatchObject({ status: "reconnect_required", encryptedRefreshToken: null });
  });

  it("preserves an existing encrypted refresh token when incremental consent omits one", async () => {
    const fixture = createOAuthFixture();
    const firstState = await authorize(fixture);
    const first = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state: firstState,
      code: "synthetic-code"
    });
    fixture.transport.tokenSet = { ...fixture.transport.tokenSet, refreshToken: null } as never;
    fixture.transport.tokenInfo = {
      ...fixture.transport.tokenInfo,
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events.owned"
      ]
    } as never;
    const secondState = await authorize(fixture, "calendar_hold_creation");
    const second = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state: secondState,
      code: "synthetic-code-2"
    });
    expect(second.encryptedRefreshToken).toEqual(first.encryptedRefreshToken);
    expect(fixture.transport.authorizationCalls[1]?.prompt).toBeNull();
  });

  it("rejects an account-subject swap until explicit disconnect", async () => {
    const fixture = createOAuthFixture();
    const firstState = await authorize(fixture);
    await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state: firstState,
      code: "synthetic-code"
    });
    fixture.transport.identity = {
      subject: "different-google-subject",
      email: "second@example.test",
      emailVerified: true
    };
    fixture.transport.tokenInfo = {
      ...fixture.transport.tokenInfo,
      subject: "different-google-subject"
    } as never;
    const secondState = await authorize(fixture);
    await expect(
      fixture.oauth.handleCallback({
        userId: FIXED_VERA_USER_ID,
        state: secondState,
        code: "synthetic-code-2"
      })
    ).rejects.toMatchObject({ code: "account_linking_conflict" });
  });

  it("refreshes in memory and transitions invalid_grant to revoked", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    const connection = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    await expect(
      fixture.oauth.refreshAccessToken({
        userId: FIXED_VERA_USER_ID,
        requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
      })
    ).resolves.toBe("synthetic-refreshed-access-token");

    fixture.transport.refreshed = new GoogleOAuthProviderError("invalid_grant", false);
    await expect(
      fixture.oauth.refreshAccessToken({
        userId: FIXED_VERA_USER_ID,
        requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
      })
    ).rejects.toMatchObject({ code: "reconnect_required" });
    expect(fixture.connections.get(connection.id)).toMatchObject({
      status: "revoked",
      encryptedRefreshToken: null
    });
  });

  it("revalidates actual scopes and identity on every refreshed access token", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    const connection = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    fixture.transport.tokenInfo = {
      ...fixture.transport.tokenInfo,
      scopes: ["openid", "email"]
    } as never;

    await expect(
      fixture.oauth.refreshAccessToken({
        userId: FIXED_VERA_USER_ID,
        requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
      })
    ).rejects.toMatchObject({ code: "scope_not_granted" });
    expect(fixture.connections.get(connection.id)).toMatchObject({
      status: "partial",
      grantedScopes: ["email", "openid"]
    });
  });

  it("restores an expired connection only after a verified refresh", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    const connection = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    fixture.connections.set(connection.id, { ...connection, status: "expired" });

    await expect(
      fixture.oauth.refreshAccessToken({
        userId: FIXED_VERA_USER_ID,
        requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
      })
    ).resolves.toBe("synthetic-refreshed-access-token");
    expect(fixture.connections.get(connection.id)).toMatchObject({ status: "connected" });
  });

  it("retries one safe transient refresh failure and no more", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    fixture.transport.refreshScript.push(new GoogleOAuthProviderError("transient_failure", true), {
      accessToken: "synthetic-retried-access-token",
      refreshToken: null,
      expiresAt: "2026-07-21T18:00:00.000Z"
    });
    await expect(
      fixture.oauth.refreshAccessToken({
        userId: FIXED_VERA_USER_ID,
        requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
      })
    ).resolves.toBe("synthetic-retried-access-token");
    expect(fixture.transport.refreshCalls).toHaveLength(2);
  });

  it("serializes refresh and disconnect provider calls with one expiring database lease", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    let releaseRefresh = (_value: {
      accessToken: string;
      refreshToken: null;
      expiresAt: string;
    }) => {};
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    fixture.transport.refreshAccessToken = async (refreshToken) => {
      fixture.transport.refreshCalls.push(refreshToken);
      markStarted();
      return new Promise((resolve) => {
        releaseRefresh = resolve;
      });
    };

    const first = fixture.oauth.refreshAccessToken({
      userId: FIXED_VERA_USER_ID,
      requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
    });
    await started;
    await expect(
      fixture.oauth.refreshAccessToken({
        userId: FIXED_VERA_USER_ID,
        requiredScope: "https://www.googleapis.com/auth/calendar.freebusy"
      })
    ).rejects.toMatchObject({ code: "integration_refresh_in_progress", httpStatus: 503 });
    await expect(fixture.oauth.disconnect({ userId: FIXED_VERA_USER_ID })).rejects.toMatchObject({
      code: "integration_refresh_in_progress",
      httpStatus: 503
    });
    expect(fixture.transport.refreshCalls).toHaveLength(1);
    expect(fixture.transport.revocationCalls).toHaveLength(0);

    releaseRefresh({
      accessToken: "synthetic-leased-access-token",
      refreshToken: null,
      expiresAt: "2026-07-21T18:00:00.000Z"
    });
    await expect(first).resolves.toBe("synthetic-leased-access-token");
    expect(fixture.refreshLeases.size).toBe(0);
  });

  it("revokes before deleting and treats an already-invalid grant as disconnected", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    fixture.transport.revocationError = new GoogleOAuthProviderError("invalid_grant", false);
    await fixture.oauth.disconnect({ userId: FIXED_VERA_USER_ID });
    expect(fixture.transport.revocationCalls).toHaveLength(1);
    expect([...fixture.connections.values()]).toEqual([
      expect.objectContaining({
        status: "disconnected",
        encryptedRefreshToken: null,
        grantedScopes: []
      })
    ]);
    expect(fixture.activities.at(-1)?.action).toBe("calendar.authorization_completed");
  });

  it("clears local credentials and requires visible manual revocation after transient failure", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    fixture.transport.revocationError = new GoogleOAuthProviderError("transient_failure", true);
    await expect(fixture.oauth.disconnect({ userId: FIXED_VERA_USER_ID })).rejects.toMatchObject({
      code: "provider_revocation_unconfirmed"
    });
    expect(fixture.transport.revocationCalls).toHaveLength(2);
    expect([...fixture.connections.values()]).toEqual([
      expect.objectContaining({ status: "disconnected", encryptedRefreshToken: null })
    ]);
    expect(fixture.activities.at(-1)?.metadata).toMatchObject({
      state: "disconnected",
      safeErrorCode: "provider_revocation_unconfirmed"
    });
  });

  it("clears local credential material even when the stored envelope cannot be decrypted", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    const connection = await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    fixture.connections.set(connection.id, {
      ...connection,
      encryptedRefreshToken: {
        ...connection.encryptedRefreshToken!,
        authenticationTag: Buffer.alloc(16, 9).toString("base64")
      }
    });

    await expect(fixture.oauth.disconnect({ userId: FIXED_VERA_USER_ID })).rejects.toMatchObject({
      code: "provider_revocation_unconfirmed"
    });
    expect(fixture.transport.revocationCalls).toHaveLength(0);
    expect(fixture.connections.get(connection.id)).toMatchObject({
      status: "disconnected",
      encryptedRefreshToken: null
    });
  });

  it("keeps secrets and personal account details out of logs and audit metadata", async () => {
    const fixture = createOAuthFixture();
    const state = await authorize(fixture);
    await fixture.oauth.handleCallback({
      userId: FIXED_VERA_USER_ID,
      state,
      code: "synthetic-code"
    });
    const captured = JSON.stringify({ logs: fixture.logs, activities: fixture.activities });
    for (const forbidden of [
      state,
      "synthetic-code",
      "synthetic-client-secret",
      "synthetic-access-token",
      "synthetic-refresh-token",
      "synthetic-id-token",
      "renter@example.test"
    ]) {
      expect(captured).not.toContain(forbidden);
    }
  });
});
