import {
  StaticCredentialKeyProvider,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import type { GmailOAuthState, VeraUserId } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { createGmailIntegrationOAuth } from "./gmail-integration-oauth.ts";
import type { GoogleOAuthTransport } from "./google-integration-oauth.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;

function fixture() {
  const states = new Map<string, GmailOAuthState>();
  const authorization = vi.fn(
    (input: Parameters<GoogleOAuthTransport["createAuthorizationUrl"]>[0]) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", input.state);
      url.searchParams.set("scope", input.scopes.join(" "));
      url.searchParams.set(
        "redirect_uri",
        "https://vera.example.test/api/integrations/google/gmail/callback"
      );
      url.searchParams.set("code_challenge", input.codeChallenge);
      return url.href;
    }
  );
  const repositories = {
    integrationConnections: { list: vi.fn(async () => []) },
    gmailOAuthStates: {
      async insert(state: GmailOAuthState) {
        states.set(state.stateHash, state);
        return state;
      },
      async consume(stateHash: string, consumedAt: string) {
        const state = states.get(stateHash);
        if (
          !state ||
          state.consumedAt !== null ||
          Date.parse(state.expiresAt) <= Date.parse(consumedAt)
        ) {
          throw new Error("invalid state");
        }
        const consumed = { ...state, consumedAt };
        states.set(stateHash, consumed);
        return consumed;
      }
    },
    activityEvents: { append: vi.fn(async (event) => event) }
  } as unknown as UserRepositories;
  const provider: UserRepositoryProvider = {
    forUser: () => repositories,
    async transaction(_userId, operation) {
      return operation(repositories);
    }
  };
  const transport: GoogleOAuthTransport = {
    createAuthorizationUrl: authorization,
    exchangeCode: vi.fn(),
    verifyIdentity: vi.fn(),
    inspectAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    revokeToken: vi.fn()
  };
  let sequence = 0;
  const oauth = createGmailIntegrationOAuth({
    configuration: {
      clientId: "client-id.apps.example.test",
      clientSecret: "synthetic-client-secret",
      redirectUri: "https://vera.example.test/api/integrations/google/calendar/callback",
      gmailRedirectUri: "https://vera.example.test/api/integrations/google/gmail/callback",
      publicBaseUrl: "https://vera.example.test",
      oauthStateTtlMilliseconds: 600_000,
      providerTimeoutMilliseconds: 1_000,
      credentialKeyProvider: new StaticCredentialKeyProvider(
        "test-key",
        new Map([["test-key", Buffer.alloc(32, 4)]])
      )
    },
    repositoryProvider: provider,
    transport,
    clock: () => new Date("2026-07-22T12:00:00.000Z"),
    randomBytes: () => Buffer.alloc(32, 7),
    randomId: () => `gmail-oauth-${++sequence}`
  });
  return { oauth, authorization, states };
}

describe("Gmail integration OAuth", () => {
  it("requests only identity plus gmail.readonly through a single-use PKCE state", async () => {
    const { oauth, authorization, states } = fixture();
    const result = await oauth.createAuthorization({
      userId: USER_ID,
      returnTo: "/settings/integrations"
    });
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
      ["email", "openid", "https://www.googleapis.com/auth/gmail.readonly"].sort()
    );
    expect(authorization).toHaveBeenCalledWith(expect.objectContaining({ prompt: "consent" }));
    expect(states.size).toBe(1);
    expect(JSON.stringify([...states.values()])).not.toContain(url.searchParams.get("state"));
  });

  it("rejects a mismatched callback state without exchanging a code", async () => {
    const { oauth } = fixture();
    await expect(
      oauth.handleCallback({
        userId: USER_ID,
        state: Buffer.alloc(32, 9).toString("base64url"),
        code: "untrusted-code"
      })
    ).rejects.toMatchObject({ code: "invalid_state", httpStatus: 400 });
  });
});
