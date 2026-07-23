import { afterEach, describe, expect, it } from "vitest";

import { clearApplicationForTesting } from "../../../../../../lib/server/application-registry.ts";
import {
  FIXED_VERA_USER_ID,
  OTHER_VERA_USER_ID,
  createOAuthFixture,
  registerOAuthRouteApplication
} from "../../../../../../lib/server/google-integration-oauth.test-fixtures.ts";
import { GET } from "./route.ts";

const originalBaseUrl = process.env.VERA_PUBLIC_BASE_URL;

afterEach(() => {
  clearApplicationForTesting();
  if (originalBaseUrl === undefined) delete process.env.VERA_PUBLIC_BASE_URL;
  else process.env.VERA_PUBLIC_BASE_URL = originalBaseUrl;
});

async function start(fixture: ReturnType<typeof createOAuthFixture>): Promise<string> {
  const authorization = await fixture.oauth.createAuthorization({
    userId: FIXED_VERA_USER_ID,
    capability: "calendar_conflict_checking",
    returnTo: "/settings/integrations"
  });
  return new URL(authorization.authorizationUrl).searchParams.get("state") ?? "";
}

describe("GET Google Calendar callback", () => {
  it("exchanges server-side and redirects safely after verified consent", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    const state = await start(fixture);
    registerOAuthRouteApplication(fixture);
    const response = await GET(
      new Request(
        `https://vera.example.test/api/integrations/google/calendar/callback?state=${state}&code=synthetic-code`
      )
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://vera.example.test/settings/integrations?calendar=connected"
    );
    expect(fixture.transport.exchangeCalls).toHaveLength(1);
  });

  it("binds the single-use state to the authoritative Vera session", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    const state = await start(fixture);
    registerOAuthRouteApplication(fixture, OTHER_VERA_USER_ID);
    const response = await GET(
      new Request(
        `https://vera.example.test/api/integrations/google/calendar/callback?state=${state}&code=synthetic-code`
      )
    );
    expect(response.status).toBe(400);
    expect(fixture.transport.exchangeCalls).toHaveLength(0);
  });

  it("consumes denied consent state without exchanging a code", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    const state = await start(fixture);
    registerOAuthRouteApplication(fixture);
    const response = await GET(
      new Request(
        `https://vera.example.test/api/integrations/google/calendar/callback?state=${state}&error=access_denied`
      )
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("calendar=denied");
    expect(fixture.transport.exchangeCalls).toHaveLength(0);
    expect(fixture.activities.at(-1)?.action).toBe("calendar.authorization_denied");
  });

  it("rejects duplicate or extra callback parameters", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    const state = await start(fixture);
    registerOAuthRouteApplication(fixture);
    const response = await GET(
      new Request(
        `https://vera.example.test/api/integrations/google/calendar/callback?state=${state}&state=${state}&code=synthetic-code`
      )
    );
    expect(response.status).toBe(400);
    expect(fixture.transport.exchangeCalls).toHaveLength(0);
  });

  it("rejects a callback request whose origin differs from the trusted callback origin", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    const state = await start(fixture);
    registerOAuthRouteApplication(fixture);
    const response = await GET(
      new Request(
        `https://spoofed-host.example.test/api/integrations/google/calendar/callback?state=${state}&code=synthetic-code`
      )
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(fixture.transport.exchangeCalls).toHaveLength(0);

    const retry = await GET(
      new Request(
        `https://vera.example.test/api/integrations/google/calendar/callback?state=${state}&code=synthetic-code`
      )
    );
    expect(retry.status).toBe(303);
    expect(fixture.transport.exchangeCalls).toHaveLength(1);
  });
});
