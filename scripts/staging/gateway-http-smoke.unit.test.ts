import { describe, expect, it, vi } from "vitest";

import {
  GATEWAY_HTTP_CHECKS,
  parseGatewayHttpSmokeEnvironment,
  runGatewayHttpSmoke,
  type GatewayFetch
} from "./gateway-http-smoke.ts";

describe("gateway HTTP smoke environment", () => {
  it("requires an exact explicit flag and a clean HTTPS origin", () => {
    expect(() => parseGatewayHttpSmokeEnvironment({})).toThrow(
      "VERA_GATEWAY_HTTP_SMOKE must be exactly 1."
    );
    expect(() =>
      parseGatewayHttpSmokeEnvironment({
        VERA_GATEWAY_HTTP_SMOKE: "1",
        OPENCLAW_GATEWAY_URL: "http://gateway.example.test"
      })
    ).toThrow("OPENCLAW_GATEWAY_URL must use HTTPS or WSS.");
  });
});

describe("gateway HTTP negative matrix", () => {
  it("uses the fixed order, redirect errors, bounded JSON, timeout signals, and no auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImplementation: GatewayFetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      const status = path === "/tools/invoke" ? 403 : 404;
      return new Response("not found", { status });
    });

    const result = await runGatewayHttpSmoke({
      gatewayUrl: "https://gateway.example.test",
      fetchImplementation
    });

    expect(result.outcome).toBe("passed");
    expect(result.checks.map(({ id }) => id)).toEqual(GATEWAY_HTTP_CHECKS.map(({ id }) => id));
    expect(calls).toHaveLength(GATEWAY_HTTP_CHECKS.length);
    for (const call of calls) {
      expect(call.init.redirect).toBe("error");
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(call.init.headers).has("authorization")).toBe(false);
      if (call.init.body) {
        expect(new TextEncoder().encode(String(call.init.body)).byteLength).toBeLessThanOrEqual(
          1024
        );
        expect(new Headers(call.init.headers).get("content-type")).toBe("application/json");
      }
    }
  });

  it("rejects redirects and unexpected success while continuing the matrix", async () => {
    let call = 0;
    const fetchImplementation: GatewayFetch = vi.fn(async () => {
      call += 1;
      return new Response(null, { status: call === 1 ? 302 : call === 2 ? 200 : 404 });
    });

    const result = await runGatewayHttpSmoke({
      gatewayUrl: "https://gateway.example.test",
      fetchImplementation
    });

    expect(result.outcome).toBe("failed");
    expect(result.checks).toHaveLength(GATEWAY_HTTP_CHECKS.length);
    expect(result.checks[0]).toMatchObject({ status: "failed", code: "unexpected_redirect" });
    expect(result.checks[1]).toMatchObject({ status: "failed", code: "unexpected_success" });
  });

  it("bounds each request to the configured timeout and records a safe failure", async () => {
    const fetchImplementation: GatewayFetch = vi.fn(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("private gateway token")), {
            once: true
          });
        })
    );

    const result = await runGatewayHttpSmoke({
      gatewayUrl: "https://gateway.example.test",
      fetchImplementation,
      timeoutMilliseconds: 5
    });

    expect(result.checks).toHaveLength(GATEWAY_HTTP_CHECKS.length);
    expect(result.checks.every(({ code }) => code === "request_timed_out")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private gateway token");
  });
});
