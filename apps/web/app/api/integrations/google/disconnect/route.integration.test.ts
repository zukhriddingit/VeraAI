import { afterEach, describe, expect, it } from "vitest";

import { clearApplicationForTesting } from "../../../../../lib/server/application-registry.ts";
import {
  FIXED_VERA_USER_ID,
  createOAuthFixture,
  registerOAuthRouteApplication
} from "../../../../../lib/server/google-integration-oauth.test-fixtures.ts";
import { GoogleOAuthProviderError } from "../../../../../lib/server/google-integration-oauth.ts";
import { POST } from "./route.ts";

const originalBaseUrl = process.env.VERA_PUBLIC_BASE_URL;

afterEach(() => {
  clearApplicationForTesting();
  if (originalBaseUrl === undefined) delete process.env.VERA_PUBLIC_BASE_URL;
  else process.env.VERA_PUBLIC_BASE_URL = originalBaseUrl;
});

async function connectedFixture() {
  const fixture = createOAuthFixture();
  const authorization = await fixture.oauth.createAuthorization({
    userId: FIXED_VERA_USER_ID,
    capability: "calendar_conflict_checking",
    returnTo: "/settings/integrations"
  });
  const state = new URL(authorization.authorizationUrl).searchParams.get("state") ?? "";
  await fixture.oauth.handleCallback({
    userId: FIXED_VERA_USER_ID,
    state,
    code: "synthetic-code"
  });
  return fixture;
}

function request(origin: string): Request {
  return new Request("https://vera.example.test/api/integrations/google/disconnect", {
    method: "POST",
    headers: { Origin: origin }
  });
}

describe("POST Google disconnect", () => {
  it("revokes the grant and removes Vera's stored credential", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = await connectedFixture();
    registerOAuthRouteApplication(fixture);
    const response = await POST(request("https://vera.example.test"));
    expect(response.status).toBe(200);
    expect(fixture.transport.revocationCalls).toHaveLength(1);
    expect([...fixture.connections.values()]).toEqual([
      expect.objectContaining({ status: "disconnected", encryptedRefreshToken: null })
    ]);
  });

  it("rejects cross-origin disconnect without revocation", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = await connectedFixture();
    registerOAuthRouteApplication(fixture);
    const response = await POST(request("https://attacker.example.test"));
    expect(response.status).toBe(403);
    expect(fixture.transport.revocationCalls).toHaveLength(0);
    expect(fixture.connections.size).toBe(1);
  });

  it("warns visibly but deletes local credentials when Google revocation is unavailable", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = await connectedFixture();
    fixture.transport.revocationError = new GoogleOAuthProviderError("transient_failure", true);
    registerOAuthRouteApplication(fixture);
    const response = await POST(request("https://vera.example.test"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "provider_revocation_unconfirmed"
    });
    expect([...fixture.connections.values()]).toEqual([
      expect.objectContaining({ status: "disconnected", encryptedRefreshToken: null })
    ]);
  });
});
