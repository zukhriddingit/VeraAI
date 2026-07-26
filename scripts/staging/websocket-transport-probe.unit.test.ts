import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import {
  credentialProtocolSha256,
  runWebSocketTransportCase,
  sanitizeProtocols
} from "./websocket-transport-probe.ts";

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
});

describe("secret-safe WebSocket transport probe", () => {
  it("hashes credential protocols and never returns their values", () => {
    const credential = `openclaw-extension-token.${"a".repeat(64)}`;
    const sanitized = sanitizeProtocols(["openclaw-extension-relay", credential], [1]);

    expect(sanitized).toEqual({
      protocolCount: 2,
      nonSecretProtocols: ["openclaw-extension-relay"],
      credentialProtocolSha256: [credentialProtocolSha256(credential)]
    });
    expect(JSON.stringify(sanitized)).not.toContain(credential);
  });

  it("reports the HTTP status from a rejected upgrade without returning headers", async () => {
    const server = createServer();
    server.on("upgrade", (_request, socket) => {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    });
    const port = await listen(server);

    const observation = await runWebSocketTransportCase({
      caseId: "rejected",
      url: `ws://127.0.0.1:${port}/browser/extension`,
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      protocols: [],
      credentialProtocolIndexes: [],
      stabilityMilliseconds: 50,
      timeoutMilliseconds: 1_000,
      payload: null
    });

    expect(observation).toMatchObject({
      caseId: "rejected",
      reachedOpen: false,
      httpStatus: 403,
      selectedProtocol: null,
      offeredProtocolCount: 0,
      nonSecretProtocols: [],
      credentialProtocolSha256: [],
      originPresent: true,
      originScheme: "chrome-extension",
      closeCode: null,
      pingPong: "not_run",
      boundedEcho: "not_run",
      errorCode: "http_rejection"
    });
    expect(JSON.stringify(observation)).not.toContain("127.0.0.1");
    expect(JSON.stringify(observation)).not.toContain("headers");
  });

  it("records selected protocol, ping pong, echo, and bounded stability", async () => {
    const server = createServer();
    const webSockets = new WebSocketServer({
      noServer: true,
      handleProtocols(protocols) {
        return protocols.has("safe-one") ? "safe-one" : false;
      }
    });
    server.on("upgrade", (request, socket, head) => {
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.on("message", (value, binary) => webSocket.send(value, { binary }));
      });
    });
    const port = await listen(server);

    const observation = await runWebSocketTransportCase({
      caseId: "accepted",
      url: `ws://127.0.0.1:${port}/browser/extension`,
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      protocols: ["safe-one", "safe-two"],
      credentialProtocolIndexes: [],
      stabilityMilliseconds: 50,
      timeoutMilliseconds: 1_000,
      payload: new TextEncoder().encode("bounded-payload")
    });

    expect(observation).toMatchObject({
      caseId: "accepted",
      reachedOpen: true,
      httpStatus: 101,
      selectedProtocol: "safe-one",
      offeredProtocolCount: 2,
      nonSecretProtocols: ["safe-one", "safe-two"],
      credentialProtocolSha256: [],
      originPresent: true,
      originScheme: "chrome-extension",
      closeCode: 1000,
      pingPong: "passed",
      boundedEcho: "passed",
      errorCode: "none"
    });
    expect(observation.lifetimeMilliseconds).toBeGreaterThanOrEqual(50);

    webSockets.close();
  });

  it("never returns a selected credential-bearing protocol", async () => {
    const credential = `openclaw-extension-token.${"b".repeat(64)}`;
    const server = createServer();
    const webSockets = new WebSocketServer({
      noServer: true,
      handleProtocols() {
        return credential;
      }
    });
    server.on("upgrade", (request, socket, head) => {
      webSockets.handleUpgrade(request, socket, head, () => undefined);
    });
    const port = await listen(server);

    const observation = await runWebSocketTransportCase({
      caseId: "credential-selected",
      url: `ws://127.0.0.1:${port}/browser/extension`,
      origin: null,
      protocols: ["openclaw-extension-relay", credential],
      credentialProtocolIndexes: [1],
      stabilityMilliseconds: 25,
      timeoutMilliseconds: 1_000,
      payload: null
    });

    expect(observation.selectedProtocol).toBe("credential_protocol");
    expect(JSON.stringify(observation)).not.toContain(credential);

    webSockets.close();
  });
});
