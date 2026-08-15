import { createServer } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { runWebSocketTransportCase } from "../../../scripts/staging/websocket-transport-probe.ts";

// Plain ESM is intentional because this exact source is copied into the Gateway image.
// @ts-expect-error The runtime module has no generated declaration file.
import { startRemoteExtensionRouteFilter } from "./remote-extension-route-filter.mjs";

interface Closable {
  close(): Promise<void>;
}

const active: Closable[] = [];

afterEach(async () => {
  await Promise.all(active.splice(0).map(async (value) => await value.close()));
});

async function startUpstream(): Promise<{
  readonly port: number;
  readonly observations: Array<{
    readonly path: string;
    readonly origin: string | undefined;
    readonly protocols: string | undefined;
  }>;
  close(): Promise<void>;
}> {
  const observations: Array<{
    readonly path: string;
    readonly origin: string | undefined;
    readonly protocols: string | undefined;
  }> = [];
  const server = createServer((_request, response) => {
    response.writeHead(404, { Connection: "close" });
    response.end();
  });
  const webSockets = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      return protocols.has("openclaw-extension-relay") ? "openclaw-extension-relay" : false;
    }
  });
  server.on("upgrade", (request, socket, head) => {
    observations.push({
      path: request.url ?? "",
      origin: request.headers.origin,
      protocols: request.headers["sec-websocket-protocol"]
    });
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request);
    });
  });
  webSockets.on("connection", (webSocket) => {
    webSocket.on("message", (value, binary) => {
      webSocket.send(value, { binary });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Upstream did not bind.");

  return {
    port: address.port,
    observations,
    async close() {
      for (const client of webSockets.clients) client.terminate();
      await new Promise<void>((resolve, reject) => {
        webSockets.close((webSocketError) => {
          if (webSocketError) {
            reject(webSocketError);
            return;
          }
          server.close((serverError) => (serverError ? reject(serverError) : resolve()));
        });
      });
    }
  };
}

describe("remote extension route filter", () => {
  it("forwards only the exact extension route without rewriting upgrade fields", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port
    });
    active.push(filter);

    const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const observation = await runWebSocketTransportCase({
      caseId: "route-filter-exact",
      url: `ws://127.0.0.1:${filter.port}/browser/extension`,
      origin,
      protocols: ["openclaw-extension-relay", "harmless-two"],
      credentialProtocolIndexes: [],
      stabilityMilliseconds: 50,
      timeoutMilliseconds: 1_000,
      payload: new Uint8Array([1, 2, 3])
    });

    expect(observation).toMatchObject({
      reachedOpen: true,
      httpStatus: 101,
      selectedProtocol: "openclaw-extension-relay",
      boundedEcho: "passed",
      closeCode: 1000
    });
    expect(upstream.observations).toEqual([
      {
        path: "/browser/extension",
        origin,
        protocols: "openclaw-extension-relay,harmless-two"
      }
    ]);
  });

  it("rejects an unrelated WebSocket path before upstream", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port
    });
    active.push(filter);

    const observation = await runWebSocketTransportCase({
      caseId: "route-filter-unrelated",
      url: `ws://127.0.0.1:${filter.port}/unrelated`,
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      protocols: ["openclaw-extension-relay"],
      credentialProtocolIndexes: [],
      stabilityMilliseconds: 25,
      timeoutMilliseconds: 1_000,
      payload: null
    });

    expect(observation).toMatchObject({ reachedOpen: false, httpStatus: 404 });
    expect(upstream.observations).toEqual([]);
  });

  it("rejects an unknown protocol before upstream", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port
    });
    active.push(filter);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const webSocket = new WebSocket(`ws://127.0.0.1:${filter.port}/browser/extension`, [
        "unexpected-protocol"
      ]);
      webSocket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      });
      webSocket.once("open", () => reject(new Error("Unknown protocol opened.")));
      webSocket.once("error", () => undefined);
    });

    expect(status).toBe(400);
    expect(upstream.observations).toEqual([]);
  });

  it("handles enrollment without forwarding it to OpenClaw or exposing the credential", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const checkpointRequests: Array<Record<string, unknown>> = [];
    const pairingCredential = "e".repeat(64);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port,
      enrollmentDependencies: {
        configuration: {
          checkpointUrl:
            "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
          publicGatewayOrigin: "https://gateway-a.verahousing.app",
          checkpointToken: "f".repeat(64)
        },
        fetchImplementation: async (url: string, options: RequestInit) => {
          checkpointRequests.push({
            url,
            authorization: new Headers(options.headers).get("authorization"),
            origin: new Headers(options.headers).get("origin"),
            cache: options.cache,
            redirect: options.redirect,
            body: options.body
          });
          return Response.json({
            allowed: true,
            assignmentId: "10000000-0000-4000-8000-000000000013"
          });
        },
        readCredentialImplementation: () => pairingCredential
      }
    });
    active.push(filter);

    const output = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const webSocket = new WebSocket(
        `ws://127.0.0.1:${filter.port}/browser/extension`,
        "vera-browser-enrollment.v1"
      );
      webSocket.once("open", () => {
        webSocket.send(
          JSON.stringify({
            ticket: "A".repeat(43),
            extensionVersion: "2.2.0",
            protocolVersion: "1",
            installationId: "b".repeat(64),
            requestedAt: "2026-08-14T12:00:10.000Z"
          })
        );
      });
      webSocket.once("message", (data) => resolve(JSON.parse(data.toString())));
      webSocket.once("error", reject);
    });

    expect(output).toEqual({
      protocol: "vera-browser-enrollment.v1",
      token: pairingCredential
    });
    expect(upstream.observations).toEqual([]);
    expect(checkpointRequests).toEqual([
      expect.objectContaining({
        url: "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
        authorization: `Bearer ${"f".repeat(64)}`,
        origin: "https://gateway-a.verahousing.app",
        cache: "no-store",
        redirect: "error"
      })
    ]);
    expect(JSON.stringify(checkpointRequests)).not.toContain(pairingCredential);
  });

  it("collapses checkpoint denials to one generic client response", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port,
      enrollmentDependencies: {
        configuration: {
          checkpointUrl:
            "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
          publicGatewayOrigin: "https://gateway-a.verahousing.app",
          checkpointToken: "f".repeat(64)
        },
        fetchImplementation: async () =>
          Response.json({ allowed: false, reason: "ticket_replayed" }),
        readCredentialImplementation: () => {
          throw new Error("Credential must not be read for a denied ticket.");
        }
      }
    });
    active.push(filter);

    const output = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const webSocket = new WebSocket(
        `ws://127.0.0.1:${filter.port}/browser/extension`,
        "vera-browser-enrollment.v1"
      );
      webSocket.once("open", () => {
        webSocket.send(
          JSON.stringify({
            ticket: "A".repeat(43),
            extensionVersion: "2.2.0",
            protocolVersion: "1",
            installationId: "b".repeat(64),
            requestedAt: "2026-08-14T12:00:10.000Z"
          })
        );
      });
      webSocket.once("message", (data) => resolve(JSON.parse(data.toString())));
      webSocket.once("error", reject);
    });

    expect(output).toEqual({
      protocol: "vera-browser-enrollment.v1",
      error: "ticket_invalid"
    });
    expect(upstream.observations).toEqual([]);
  });

  it("enforces a bounded first frame and enrollment timeout", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port,
      enrollmentDependencies: {
        configuration: {
          checkpointUrl:
            "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
          publicGatewayOrigin: "https://gateway-a.verahousing.app",
          checkpointToken: "f".repeat(64)
        },
        enrollmentTimeoutMilliseconds: 25,
        fetchImplementation: async () => {
          throw new Error("No checkpoint call expected.");
        },
        readCredentialImplementation: () => {
          throw new Error("No credential read expected.");
        }
      }
    });
    active.push(filter);

    const timeoutCode = await new Promise<number>((resolve, reject) => {
      const webSocket = new WebSocket(
        `ws://127.0.0.1:${filter.port}/browser/extension`,
        "vera-browser-enrollment.v1"
      );
      webSocket.once("close", resolve);
      webSocket.once("error", reject);
    });
    expect(timeoutCode).toBe(1008);

    const oversizedCode = await new Promise<number>((resolve, reject) => {
      const webSocket = new WebSocket(
        `ws://127.0.0.1:${filter.port}/browser/extension`,
        "vera-browser-enrollment.v1"
      );
      webSocket.once("open", () => webSocket.send("x".repeat(4_097)));
      webSocket.once("close", resolve);
      webSocket.once("error", () => undefined);
      setTimeout(() => reject(new Error("Oversized frame did not close.")), 1_000);
    });
    expect(oversizedCode).toBe(1009);
    expect(upstream.observations).toEqual([]);
  });

  it("rejects a query-bearing extension route before upstream", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port
    });
    active.push(filter);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const webSocket = new WebSocket(
        `ws://127.0.0.1:${filter.port}/browser/extension?profile=chrome`,
        ["openclaw-extension-relay"]
      );
      webSocket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode);
      });
      webSocket.once("open", () => reject(new Error("Query-bearing route opened.")));
      webSocket.once("error", () => undefined);
    });

    expect(status).toBe(404);
    expect(upstream.observations).toEqual([]);
  });

  it("exposes only the non-upgrading route hint over HTTP", async () => {
    const upstream = await startUpstream();
    active.push(upstream);
    const filter = await startRemoteExtensionRouteFilter({
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstream.port
    });
    active.push(filter);

    const accepted = await fetch(`http://127.0.0.1:${filter.port}/browser/extension`);
    const rejected = await fetch(`http://127.0.0.1:${filter.port}/unrelated`);

    expect(accepted.status).toBe(426);
    expect(rejected.status).toBe(404);
    expect(upstream.observations).toEqual([]);
  });
});
