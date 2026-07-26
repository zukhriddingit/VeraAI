import { describe, expect, it } from "vitest";

import { runWebSocketTransportCase } from "../../../scripts/staging/websocket-transport-probe.ts";

// Plain ESM is intentional because this exact source runs inside the disposable diagnostic agent.
// @ts-expect-error The runtime module has no generated declaration file.
import { startDiagnosticWebSocketServer } from "./websocket-diagnostic-server.mjs";

interface DiagnosticObservation {
  readonly event: string;
  readonly pathClass?: string;
  readonly originPresent?: boolean;
  readonly originScheme?: string | null;
  readonly protocolCount?: number;
  readonly nonSecretProtocols?: readonly string[];
  readonly credentialProtocolSha256?: readonly string[];
  readonly reachedContainer?: boolean;
}

describe("Maritime WebSocket diagnostic service", () => {
  it("selects a harmless protocol, echoes a bounded payload, and redacts credentials", async () => {
    const logs: DiagnosticObservation[] = [];
    const server = await startDiagnosticWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      acceptedPath: "/browser/extension",
      allowedOriginSchemes: ["chrome-extension", "https"],
      allowMissingOrigin: true,
      selectedProtocol: "vera-diag-one",
      maxPayloadBytes: 65_536,
      idleTimeoutMilliseconds: 1_000,
      writeObservation(value: DiagnosticObservation) {
        logs.push(value);
      }
    });

    try {
      const credential = `openclaw-extension-token.${"c".repeat(64)}`;
      const payload = new Uint8Array(32 * 1024).fill(7);
      const observation = await runWebSocketTransportCase({
        caseId: "diagnostic-accepted",
        url: `ws://127.0.0.1:${server.port}/browser/extension`,
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        protocols: ["vera-diag-one", credential],
        credentialProtocolIndexes: [1],
        stabilityMilliseconds: 50,
        timeoutMilliseconds: 1_000,
        payload
      });

      expect(observation).toMatchObject({
        reachedOpen: true,
        httpStatus: 101,
        selectedProtocol: "vera-diag-one",
        pingPong: "passed",
        boundedEcho: "passed",
        closeCode: 1000,
        errorCode: "none"
      });
      expect(logs).toContainEqual(
        expect.objectContaining({
          event: "upgrade_observed",
          pathClass: "accepted",
          originPresent: true,
          originScheme: "chrome-extension",
          protocolCount: 2,
          nonSecretProtocols: ["vera-diag-one"],
          reachedContainer: true
        })
      );
      expect(JSON.stringify(logs)).not.toContain(credential);
    } finally {
      await server.close();
    }
  });

  it("denies invalid paths and origins before the WebSocket opens", async () => {
    const logs: DiagnosticObservation[] = [];
    const server = await startDiagnosticWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      acceptedPath: "/browser/extension",
      allowedOriginSchemes: ["chrome-extension", "https"],
      allowMissingOrigin: true,
      selectedProtocol: "vera-diag-one",
      maxPayloadBytes: 65_536,
      idleTimeoutMilliseconds: 1_000,
      writeObservation(value: DiagnosticObservation) {
        logs.push(value);
      }
    });

    try {
      const invalidPath = await runWebSocketTransportCase({
        caseId: "invalid-path",
        url: `ws://127.0.0.1:${server.port}/elsewhere`,
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        protocols: ["vera-diag-one"],
        credentialProtocolIndexes: [],
        stabilityMilliseconds: 25,
        timeoutMilliseconds: 1_000,
        payload: null
      });
      const invalidOrigin = await runWebSocketTransportCase({
        caseId: "invalid-origin",
        url: `ws://127.0.0.1:${server.port}/browser/extension`,
        origin: "http://invalid.example",
        protocols: ["vera-diag-one"],
        credentialProtocolIndexes: [],
        stabilityMilliseconds: 25,
        timeoutMilliseconds: 1_000,
        payload: null
      });

      expect(invalidPath).toMatchObject({ reachedOpen: false, httpStatus: 404 });
      expect(invalidOrigin).toMatchObject({ reachedOpen: false, httpStatus: 403 });
      expect(logs).toContainEqual(
        expect.objectContaining({ pathClass: "invalid", reachedContainer: true })
      );
      expect(logs).toContainEqual(
        expect.objectContaining({ originScheme: "http", reachedContainer: true })
      );
    } finally {
      await server.close();
    }
  });

  it("closes oversized payloads with code 1009", async () => {
    const server = await startDiagnosticWebSocketServer({
      host: "127.0.0.1",
      port: 0,
      acceptedPath: "/browser/extension",
      allowedOriginSchemes: ["chrome-extension"],
      allowMissingOrigin: false,
      selectedProtocol: "vera-diag-one",
      maxPayloadBytes: 64,
      idleTimeoutMilliseconds: 1_000,
      writeObservation() {}
    });

    try {
      const observation = await runWebSocketTransportCase({
        caseId: "oversized",
        url: `ws://127.0.0.1:${server.port}/browser/extension`,
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        protocols: ["vera-diag-one"],
        credentialProtocolIndexes: [],
        stabilityMilliseconds: 100,
        timeoutMilliseconds: 1_000,
        payload: new Uint8Array(65)
      });

      expect(observation).toMatchObject({
        reachedOpen: true,
        closeCode: 1009,
        boundedEcho: "failed",
        errorCode: "closed_early"
      });
    } finally {
      await server.close();
    }
  });
});
