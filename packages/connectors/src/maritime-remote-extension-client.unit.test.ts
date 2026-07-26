import { describe, expect, it, vi } from "vitest";

import {
  MaritimeRemoteExtensionClient,
  MaritimeRemoteExtensionError,
  REMOTE_EXTENSION_MARITIME_API_ORIGIN
} from "./maritime-remote-extension-client.ts";

const now = new Date("2026-07-25T20:00:00.000Z");

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    capturedAt: now.toISOString(),
    page: { url: "https://example.test/", title: "Shared listing" },
    textLines: ['- heading "Shared listing"'],
    sourceLineCount: 2,
    returnedLineCount: 1,
    sourceTruncated: false,
    sourceSha256: "a".repeat(64),
    contentSha256: "b".repeat(64),
    ...overrides
  };
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function client(fetchImplementation: typeof fetch) {
  return new MaritimeRemoteExtensionClient({
    apiKey: "synthetic-browser-gateway-key",
    agentId: "dedicated-founder-browser-gateway",
    fetch: fetchImplementation,
    now: () => now
  });
}

describe("Maritime remote extension client", () => {
  it("calls only the dedicated agent with a fixed no-input snapshot task", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ response: JSON.stringify(snapshot()) }));
    const result = await client(fetchImplementation).snapshot(
      "4b41df90-c5a0-4c45-94ef-1d73e6fa57bc"
    );

    expect(result.page.title).toBe("Shared listing");
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toBe(
      `${REMOTE_EXTENSION_MARITIME_API_ORIGIN}/api/agents/dedicated-founder-browser-gateway/chat`
    );
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const body = JSON.parse(String(init?.body)) as {
      message: string;
      conversation_id: string;
    };
    expect(body.conversation_id).toBe("4b41df90-c5a0-4c45-94ef-1d73e6fa57bc");
    expect(body.message).toContain(
      "vera_read_shared_tab_snapshot exactly once with an empty object"
    );
    expect(body.message).not.toContain("example.test");
  });

  it.each([
    ["Markdown output", "```json\n{}\n```"],
    ["stale output", JSON.stringify(snapshot({ capturedAt: "2026-07-25T19:00:00.000Z" }))],
    ["raw email", JSON.stringify(snapshot({ textLines: ["founder@example.test"] }))],
    ["unknown field", JSON.stringify(snapshot({ rawSnapshot: "forbidden" }))]
  ])("rejects %s", async (_label, raw) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ response: raw }));
    await expect(
      client(fetchImplementation).snapshot("4b41df90-c5a0-4c45-94ef-1d73e6fa57bc")
    ).rejects.toEqual(new MaritimeRemoteExtensionError("snapshot_invalid_response", false));
  });

  it("maps authentication and provider errors without fallback", async () => {
    const unauthorized = vi.fn<typeof fetch>().mockResolvedValue(response({}, 401));
    await expect(
      client(unauthorized).snapshot("4b41df90-c5a0-4c45-94ef-1d73e6fa57bc")
    ).rejects.toEqual(new MaritimeRemoteExtensionError("maritime_auth_failed", false));

    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(response({}, 503));
    await expect(
      client(unavailable).snapshot("4b41df90-c5a0-4c45-94ef-1d73e6fa57bc")
    ).rejects.toEqual(new MaritimeRemoteExtensionError("gateway_unavailable", true));
  });

  it("rejects oversized responses before parsing", async () => {
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": "25000" }
      })
    );
    await expect(
      client(oversized).snapshot("4b41df90-c5a0-4c45-94ef-1d73e6fa57bc")
    ).rejects.toEqual(new MaritimeRemoteExtensionError("snapshot_invalid_response", false));
  });

  it("rejects malformed timeout and response bounds at composition", () => {
    expect(
      () =>
        new MaritimeRemoteExtensionClient({
          apiKey: "synthetic-browser-gateway-key",
          agentId: "dedicated-founder-browser-gateway",
          timeoutMilliseconds: 999
        })
    ).toThrow(/TIMEOUT_MS/u);
    expect(
      () =>
        new MaritimeRemoteExtensionClient({
          apiKey: "synthetic-browser-gateway-key",
          agentId: "dedicated-founder-browser-gateway",
          maxResponseBytes: 20_001
        })
    ).toThrow(/MAX_RESPONSE_BYTES/u);
  });
});
