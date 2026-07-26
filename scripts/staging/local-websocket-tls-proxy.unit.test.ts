import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { startLocalWebSocketTlsProxy } from "./local-websocket-tls-proxy.ts";
import { runWebSocketTransportCase } from "./websocket-transport-probe.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("local WebSocket TLS proxy", () => {
  it("preserves path, Origin, ordered protocols, and selected response protocol", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vera-r2-tls-"));
    const keyPath = join(directory, "key.pem");
    const certificatePath = join(directory, "cert.pem");
    execFileSync("/usr/bin/openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-keyout",
      keyPath,
      "-out",
      certificatePath
    ]);
    cleanups.push(async () => await rm(directory, { recursive: true, force: true }));

    const received: {
      path: string | null;
      origin: string | null;
      protocols: string | null;
    } = { path: null, origin: null, protocols: null };
    const upstream = createServer();
    const webSockets = new WebSocketServer({
      noServer: true,
      handleProtocols(protocols) {
        return protocols.has("safe-one") ? "safe-one" : false;
      }
    });
    upstream.on("upgrade", (request, socket, head) => {
      received.path = request.url ?? null;
      received.origin = typeof request.headers.origin === "string" ? request.headers.origin : null;
      received.protocols =
        typeof request.headers["sec-websocket-protocol"] === "string"
          ? request.headers["sec-websocket-protocol"]
          : null;
      webSockets.handleUpgrade(request, socket, head, () => undefined);
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Expected upstream TCP address.");
    }
    cleanups.push(
      async () =>
        await new Promise<void>((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve()))
        )
    );

    const proxy = await startLocalWebSocketTlsProxy({
      keyPath,
      certificatePath,
      listenHost: "127.0.0.1",
      listenPort: 0,
      upstreamHost: "127.0.0.1",
      upstreamPort: upstreamAddress.port
    });
    cleanups.push(proxy.close);

    const observation = await runWebSocketTransportCase({
      caseId: "tls-preservation",
      url: `wss://127.0.0.1:${proxy.port}/browser/extension`,
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      protocols: ["safe-one", "safe-two"],
      credentialProtocolIndexes: [],
      stabilityMilliseconds: 25,
      timeoutMilliseconds: 1_000,
      payload: null,
      tlsPolicy: "allow_ephemeral_self_signed"
    });

    expect(observation).toMatchObject({
      reachedOpen: true,
      httpStatus: 101,
      selectedProtocol: "safe-one",
      closeCode: 1000,
      errorCode: "none"
    });
    expect(received).toEqual({
      path: "/browser/extension",
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      protocols: "safe-one,safe-two"
    });

    webSockets.close();
  });
});
