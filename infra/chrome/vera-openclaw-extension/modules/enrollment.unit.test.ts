import { describe, expect, it, vi } from "vitest";

import {
  ENROLLMENT_PROTOCOL,
  EnrollmentError,
  createInstallationId,
  digestInstallationId,
  enrollmentRelayUrl,
  enrollWithGateway,
  parseEnrollmentRequest,
  parseEnrollmentResponse
} from "./enrollment.js";

const request = {
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

class FakeSocket {
  protocol = ENROLLMENT_PROTOCOL;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  close = vi.fn();

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(value: string) {
    this.sent.push(value);
  }

  emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("Browser Connector enrollment client", () => {
  it("derives only the exact existing TLS relay route", () => {
    expect(enrollmentRelayUrl("https://gateway-a.verahousing.app")).toBe(
      "wss://gateway-a.verahousing.app/browser/extension"
    );
    expect(() => enrollmentRelayUrl("https://gateway-a.verahousing.app/path")).toThrow(
      EnrollmentError
    );
    expect(() => enrollmentRelayUrl("http://gateway-a.verahousing.app")).toThrow(EnrollmentError);
  });

  it("parses closed page and Gateway frames", () => {
    expect(parseEnrollmentRequest(request)).toEqual(request);
    expect(() => parseEnrollmentRequest({ ...request, selector: "body" })).toThrow(EnrollmentError);
    expect(
      parseEnrollmentResponse({ protocol: ENROLLMENT_PROTOCOL, token: "a".repeat(64) })
    ).toEqual({ protocol: ENROLLMENT_PROTOCOL, token: "a".repeat(64) });
    expect(() =>
      parseEnrollmentResponse({
        protocol: ENROLLMENT_PROTOCOL,
        token: "a".repeat(64),
        relayUrl: "wss://evil.example/browser/extension"
      })
    ).toThrow(EnrollmentError);
  });

  it("creates a 256-bit installation ID and hashes it without exposing the raw value", async () => {
    const installationId = createInstallationId((bytes) => bytes.fill(0xab));
    expect(installationId).toBe("ab".repeat(32));
    const digest = await digestInstallationId(installationId);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digest).not.toBe(installationId);
  });

  it("sends one bounded first frame and returns the existing relay configuration", async () => {
    const socket = new FakeSocket();
    const result = enrollWithGateway(request, {
      installationId: "c".repeat(64),
      now: () => new Date("2026-08-14T12:00:10.000Z"),
      createSocket: (url, protocol) => {
        expect(url).toBe("wss://gateway-a.verahousing.app/browser/extension");
        expect(protocol).toBe(ENROLLMENT_PROTOCOL);
        return socket as unknown as WebSocket;
      }
    });
    socket.emit("open");
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      ticket: request.ticket,
      extensionVersion: "2.2.0",
      protocolVersion: "1",
      installationId: "c".repeat(64),
      requestedAt: "2026-08-14T12:00:10.000Z"
    });
    socket.emit("message", {
      data: JSON.stringify({ protocol: ENROLLMENT_PROTOCOL, token: "d".repeat(64) })
    });
    await expect(result).resolves.toEqual({
      relayUrl: "wss://gateway-a.verahousing.app/browser/extension",
      token: "d".repeat(64)
    });
  });

  it("rejects expired and typed-denied tickets without returning partial credentials", async () => {
    await expect(
      enrollWithGateway(request, {
        installationId: "c".repeat(64),
        now: () => new Date(request.expiresAt)
      })
    ).rejects.toMatchObject({ code: "expired" });

    const socket = new FakeSocket();
    const result = enrollWithGateway(request, {
      installationId: "c".repeat(64),
      now: () => new Date("2026-08-14T12:00:10.000Z"),
      createSocket: () => socket as unknown as WebSocket
    });
    socket.emit("open");
    socket.emit("message", {
      data: JSON.stringify({ protocol: ENROLLMENT_PROTOCOL, error: "ticket_replayed" })
    });
    await expect(result).rejects.toMatchObject({ code: "denied" });
  });
});
