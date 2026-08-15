import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type MessageEventLike = {
  readonly source: unknown;
  readonly origin: string;
  readonly data: Record<string, unknown>;
};

let messageListener: ((event: MessageEventLike) => void) | null = null;
const postMessage = vi.fn();
const sendMessage = vi.fn(async (message: { type: string }) => {
  if (message.type === "getStatus") {
    return {
      paired: false,
      state: "off",
      readiness: "not_shared",
      sharedTabCount: 0,
      extensionVersion: "2.2.0",
      enrollmentProtocolVersion: "1",
      installationDigest: "a".repeat(64)
    };
  }
  if (message.type === "enroll") {
    return {
      ok: true,
      requestId: "10000000-0000-4000-8000-000000000013",
      state: "connected",
      token: "must-not-be-forwarded"
    };
  }
  return { ok: true };
});

const windowMock = {
  location: { origin: "https://app.verahousing.app" },
  postMessage,
  addEventListener: vi.fn((type: string, listener: (event: MessageEventLike) => void) => {
    if (type === "message") messageListener = listener;
  })
};

const connectMessage = {
  source: "vera-web",
  type: "connect-browser",
  version: "1",
  requestId: "10000000-0000-4000-8000-000000000013",
  confirmation: "connect_read_only_browser",
  ticket: "A".repeat(43),
  expiresAt: "2026-08-14T12:01:00.000Z",
  gatewayOrigin: "https://gateway-a.verahousing.app",
  protocolVersion: "1"
};

beforeAll(async () => {
  vi.stubGlobal("window", windowMock);
  vi.stubGlobal("chrome", { runtime: { sendMessage } });
  vi.stubGlobal("setInterval", vi.fn());
  await import("./readiness-bridge.js");
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
});

beforeEach(() => {
  postMessage.mockClear();
  sendMessage.mockClear();
});

describe("Vera readiness content-script bridge", () => {
  it("publishes only the versioned, digest-only readiness contract", async () => {
    messageListener?.({
      source: windowMock,
      origin: windowMock.location.origin,
      data: {
        source: "vera-web",
        type: "clear-browser-connection",
        version: "1",
        requestId: "20000000-0000-4000-8000-000000000013"
      }
    });

    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "vera-openclaw-extension",
        type: "readiness",
        version: "2",
        extensionVersion: "2.2.0",
        enrollmentProtocolVersion: "1",
        installationDigest: "a".repeat(64)
      }),
      windowMock.location.origin
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("installationId");
  });

  it("accepts an exact same-window request and returns only sanitized states", async () => {
    if (!messageListener) throw new Error("message listener was not registered");
    messageListener({
      source: windowMock,
      origin: windowMock.location.origin,
      data: connectMessage
    });

    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "enrollment-result", state: "connected" }),
        windowMock.location.origin
      )
    );
    expect(sendMessage).toHaveBeenCalledWith({ type: "enroll", request: connectMessage });
    const results = postMessage.mock.calls
      .map(([value]) => value as Record<string, unknown>)
      .filter((value) => value.type === "enrollment-result");
    expect(results.map((value) => value.state)).toEqual(["connecting", "connected"]);
    expect(JSON.stringify(results)).not.toContain(connectMessage.ticket);
    expect(JSON.stringify(results)).not.toContain("must-not-be-forwarded");
  });

  it("ignores cross-origin, nested-window, and open-schema messages", async () => {
    if (!messageListener) throw new Error("message listener was not registered");
    messageListener({ source: windowMock, origin: "https://evil.example", data: connectMessage });
    messageListener({ source: {}, origin: windowMock.location.origin, data: connectMessage });
    messageListener({
      source: windowMock,
      origin: windowMock.location.origin,
      data: { ...connectMessage, selector: "body" }
    });
    await Promise.resolve();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
