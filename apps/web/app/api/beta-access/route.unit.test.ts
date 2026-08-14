import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BETA_CONSENT_VERSION } from "@vera/domain";

import {
  clearApplicationForTesting,
  registerApplication,
  type VeraApplication
} from "../../../lib/server/application-registry.ts";
import { createUnconfiguredCalendarApplication } from "../../../lib/server/unconfigured-calendar-application.ts";
import { POST } from "./route.ts";

const submit = vi.fn().mockResolvedValue({ id: "request" });
const consumeRateLimit = vi.fn().mockResolvedValue(true);

function register(): void {
  registerApplication({
    mode: "hosted",
    repositoryProvider: {} as VeraApplication["repositoryProvider"],
    auth: null,
    calendar: createUnconfiguredCalendarApplication(),
    gmailOAuth: null,
    betaAccess: { submit, consumeRateLimit } as never,
    browserGatewayAssignments: null,
    browserGatewayRuntime: null,
    demoUserId: null,
    readiness: vi.fn(),
    close: vi.fn()
  });
}

function request(email: string, website = ""): Request {
  return new Request("http://127.0.0.1:3000/api/beta-access", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    body: JSON.stringify({
      email,
      consent: true,
      consentVersion: BETA_CONSENT_VERSION,
      website
    })
  });
}

beforeEach(() => {
  process.env.VERA_PUBLIC_BASE_URL = "http://127.0.0.1:3000";
  process.env.VERA_BETA_RATE_LIMIT_KEY = "k".repeat(32);
  submit.mockClear();
  consumeRateLimit.mockClear().mockResolvedValue(true);
  register();
});

afterEach(() => {
  clearApplicationForTesting();
  delete process.env.VERA_PUBLIC_BASE_URL;
  delete process.env.VERA_BETA_RATE_LIMIT_KEY;
});

describe("POST /api/beta-access", () => {
  it("returns the same accepted response for normalized repeated requests", async () => {
    for (const email of ["tester@example.com", "TESTER@example.com"]) {
      const response = await POST(request(email));
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ accepted: true, code: "request_received" });
    }
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("accepts a honeypot trap without persisting it", async () => {
    const response = await POST(request("bot@example.com", "https://spam.invalid"));
    expect(response.status).toBe(202);
    expect(submit).not.toHaveBeenCalled();
  });

  it("fails before persistence when the opaque rate bucket is exhausted", async () => {
    consumeRateLimit.mockResolvedValue(false);
    expect((await POST(request("tester@example.com"))).status).toBe(429);
    expect(submit).not.toHaveBeenCalled();
  });
});
