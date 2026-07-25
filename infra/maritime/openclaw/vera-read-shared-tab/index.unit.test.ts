import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VeraSnapshotPluginError,
  minimizeSharedTabSnapshot,
  readSharedTabSnapshot
} from "./index.mjs";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Vera read-shared-tab OpenClaw plugin", () => {
  beforeEach(() => {
    process.env.OPENCLAW_GATEWAY_TOKEN = "synthetic-gateway-token";
  });

  afterEach(() => {
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    vi.restoreAllMocks();
  });

  it("minimizes a snapshot and removes private or interactive content", () => {
    const result = minimizeSharedTabSnapshot(
      {
        title: "Boston rentals",
        url: "https://example.test/search?session=sensitive#details",
        snapshot: [
          '- heading "Available apartments" [ref=e1]',
          '- textbox "Email" value="founder@example.test" [ref=e2]',
          '- text "Call +1 617-555-0101" [ref=e3]',
          '- link "One bedroom under budget" [ref=e4]',
          "- text /Users/founder/Library/Application Support/Chrome/Profile 1"
        ].join("\n"),
        truncated: false
      },
      () => new Date("2026-07-25T20:00:00.000Z")
    );

    expect(result).toMatchObject({
      schemaVersion: "1",
      capturedAt: "2026-07-25T20:00:00.000Z",
      page: {
        url: "https://example.test/",
        title: "Boston rentals"
      },
      textLines: ['- heading "Available apartments"', '- link "One bedroom under budget"'],
      returnedLineCount: 2,
      sourceTruncated: false
    });
    expect(JSON.stringify(result)).not.toMatch(/founder@example|617-555|session=|\/Users\/|ref=e/u);
    expect(result.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses only fixed GET tab and snapshot requests", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          running: true,
          tabs: [
            {
              targetId: "raw-target-never-returned",
              title: "Shared listing",
              url: "https://example.test/listing/1?tracking=removed"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          format: "ai",
          targetId: "raw-target-never-returned",
          url: "https://example.test/listing/1",
          snapshot: '- heading "Listing one" [ref=e1]'
        })
      );

    const result = await readSharedTabSnapshot(
      {},
      { fetch: fetchImplementation, now: () => new Date("2026-07-25T20:00:00.000Z") }
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    for (const call of fetchImplementation.mock.calls) {
      expect(call[1]).toMatchObject({ method: "GET", redirect: "error" });
    }
    expect(String(fetchImplementation.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:18791/tabs?profile=chrome"
    );
    expect(String(fetchImplementation.mock.calls[1]?.[0])).toContain(
      "http://127.0.0.1:18791/snapshot?"
    );
    expect(JSON.stringify(result)).not.toContain("raw-target-never-returned");
    expect(result.page.url).toBe("https://example.test/");
  });

  it.each([
    [{ unexpected: true }, "snapshot_tool_accepts_no_input"],
    [{}, "multiple_shared_tabs"]
  ])("rejects unsafe input or ambiguous consent tabs", async (params, expectedCode) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        running: true,
        tabs: [
          { targetId: "a", title: "A", url: "https://example.test/a" },
          { targetId: "b", title: "B", url: "https://example.test/b" }
        ]
      })
    );
    await expect(
      readSharedTabSnapshot(params, {
        fetch: fetchImplementation,
        now: () => new Date("2026-07-25T20:00:00.000Z")
      })
    ).rejects.toEqual(new VeraSnapshotPluginError(expectedCode));
  });

  it("rejects oversized browser-control responses before parsing", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(65 * 1024) }
      })
    );
    await expect(
      readSharedTabSnapshot(
        {},
        { fetch: fetchImplementation, now: () => new Date("2026-07-25T20:00:00.000Z") }
      )
    ).rejects.toEqual(new VeraSnapshotPluginError("browser_response_too_large"));
  });
});
