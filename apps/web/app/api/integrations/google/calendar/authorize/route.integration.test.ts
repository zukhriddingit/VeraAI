import { CalendarCapabilityAuthorizationResponseSchema } from "@vera/domain";
import { afterEach, describe, expect, it } from "vitest";

import { clearApplicationForTesting } from "../../../../../../lib/server/application-registry.ts";
import {
  createOAuthFixture,
  registerOAuthRouteApplication
} from "../../../../../../lib/server/google-integration-oauth.test-fixtures.ts";
import { POST } from "./route.ts";

const originalBaseUrl = process.env.VERA_PUBLIC_BASE_URL;

afterEach(() => {
  clearApplicationForTesting();
  if (originalBaseUrl === undefined) delete process.env.VERA_PUBLIC_BASE_URL;
  else process.env.VERA_PUBLIC_BASE_URL = originalBaseUrl;
});

function request(payload: unknown, origin = "https://vera.example.test"): Request {
  return new Request("https://vera.example.test/api/integrations/google/calendar/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(payload)
  });
}

describe("POST Google Calendar authorization", () => {
  it("authenticates and requests only the selected incremental capability", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    registerOAuthRouteApplication(fixture);
    const response = await POST(
      request({
        capability: "calendar_conflict_checking",
        returnTo: "/settings/integrations"
      })
    );
    const result = CalendarCapabilityAuthorizationResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new URL(result.authorizationUrl).searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.freebusy"
    ]);
  });

  it("rejects cross-origin and malformed capability requests", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    registerOAuthRouteApplication(fixture);
    await expect(
      POST(
        request(
          { capability: "calendar_hold_creation", returnTo: "/settings/integrations" },
          "https://attacker.example.test"
        )
      )
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      POST(request({ capability: "calendar_everything", returnTo: "//attacker.example.test" }))
    ).resolves.toMatchObject({ status: 400 });
    expect(fixture.transport.authorizationCalls).toHaveLength(0);
  });

  it("returns a typed disconnected result without constructing OAuth in demo mode", async () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    const fixture = createOAuthFixture();
    registerOAuthRouteApplication(fixture, null, "demo");
    const response = await POST(
      request({ capability: "calendar_conflict_checking", returnTo: "/settings/integrations" })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "google_disconnected" });
    expect(fixture.transport.authorizationCalls).toHaveLength(0);
  });
});
