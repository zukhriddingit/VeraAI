import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSameOriginMutation,
  assertTrustedCallbackOrigin,
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "./request-security.ts";

const originalBaseUrl = process.env.VERA_PUBLIC_BASE_URL;

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.VERA_PUBLIC_BASE_URL;
  else process.env.VERA_PUBLIC_BASE_URL = originalBaseUrl;
  vi.unstubAllEnvs();
});

function request(origin?: string): Request {
  return new Request("http://127.0.0.1:3000/api/integrations/google/disconnect", {
    method: "POST",
    ...(origin ? { headers: { origin } } : {})
  });
}

describe("same-origin mutation boundary", () => {
  it("accepts an exact configured origin", () => {
    process.env.VERA_PUBLIC_BASE_URL = "http://127.0.0.1:3000";
    expect(() => assertSameOriginMutation(request("http://127.0.0.1:3000"))).not.toThrow();
  });

  it.each([undefined, "https://attacker.example.test", "null"])(
    "rejects a missing or cross-origin value: %s",
    (origin) => {
      process.env.VERA_PUBLIC_BASE_URL = "http://127.0.0.1:3000";
      expect(() => assertSameOriginMutation(request(origin))).toThrow(CrossOriginMutationError);
    }
  );

  it("fails closed in production without an exact configured public origin", () => {
    delete process.env.VERA_PUBLIC_BASE_URL;
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertSameOriginMutation(request("http://127.0.0.1:3000"))).toThrow(
      CrossOriginMutationError
    );
  });

  it("binds callbacks to the exact configured public origin", () => {
    process.env.VERA_PUBLIC_BASE_URL = "https://vera.example.test";
    expect(() =>
      assertTrustedCallbackOrigin(
        new Request("https://vera.example.test/api/integrations/google/calendar/callback")
      )
    ).not.toThrow();
    expect(() =>
      assertTrustedCallbackOrigin(
        new Request("https://spoofed-host.example.test/api/integrations/google/calendar/callback")
      )
    ).toThrow(CrossOriginMutationError);
  });

  it("rejects a non-HTTPS configured production origin", () => {
    process.env.VERA_PUBLIC_BASE_URL = "http://vera.example.test";
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      assertTrustedCallbackOrigin(
        new Request("http://vera.example.test/api/integrations/google/calendar/callback")
      )
    ).toThrow(CrossOriginMutationError);
  });
});

describe("bounded JSON mutation parser", () => {
  it("rejects before buffering a body beyond the declared byte limit", async () => {
    const value = JSON.stringify({ a: "é" });
    const request = new Request("https://vera.example.test/api/test", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(new TextEncoder().encode(value).byteLength)
      },
      body: value
    });

    await expect(readBoundedJson(request, { maxBytes: 8 })).rejects.toEqual(
      new MutationRequestError("payload_too_large", 413)
    );
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "application/jsonp"])(
    "rejects unsupported content type %s",
    async (contentType) => {
      const request = new Request("https://vera.example.test/api/test", {
        method: "POST",
        headers: { "content-type": contentType },
        body: "{}"
      });
      await expect(readBoundedJson(request, { maxBytes: 64 })).rejects.toEqual(
        new MutationRequestError("unsupported_media_type", 415)
      );
    }
  );

  it("rejects malformed JSON and invalid UTF-8 with safe codes", async () => {
    const malformed = new Request("https://vera.example.test/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    await expect(readBoundedJson(malformed, { maxBytes: 64 })).rejects.toEqual(
      new MutationRequestError("malformed_json", 400)
    );

    const invalidUtf8 = new Request("https://vera.example.test/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0xc3, 0x28])
    });
    await expect(readBoundedJson(invalidUtf8, { maxBytes: 64 })).rejects.toEqual(
      new MutationRequestError("malformed_json", 400)
    );
  });

  it("streams bytes, cancels an oversized reader, and accepts bounded JSON", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":"'));
        controller.enqueue(new TextEncoder().encode('too large"}'));
      },
      cancel(reason) {
        cancelled = reason === "payload_too_large";
      }
    });
    const oversized = new Request("https://vera.example.test/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half"
    } as RequestInit);
    await expect(readBoundedJson(oversized, { maxBytes: 8 })).rejects.toMatchObject({
      code: "payload_too_large",
      status: 413
    });
    expect(cancelled).toBe(true);

    const accepted = new Request("https://vera.example.test/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"safe":true}'
    });
    await expect(readBoundedJson(accepted, { maxBytes: 64 })).resolves.toEqual({ safe: true });
  });
});
