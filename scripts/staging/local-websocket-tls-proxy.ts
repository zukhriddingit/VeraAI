import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";
import type { Duplex } from "node:stream";

export interface LocalTlsProxyOptions {
  readonly keyPath: string;
  readonly certificatePath: string;
  readonly listenHost: "127.0.0.1";
  readonly listenPort: number;
  readonly upstreamHost: "127.0.0.1";
  readonly upstreamPort: number;
}

const PROXY_SOCKET_TIMEOUT_MILLISECONDS = 40_000;

function validatePort(value: number, allowEphemeral: boolean): void {
  const minimum = allowEphemeral ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > 65_535) {
    throw new Error("Local TLS proxy ports must be valid TCP ports.");
  }
}

function serializeUpgradeRequest(request: IncomingMessage): Buffer {
  const requestLine = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
  const headerLines: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headerLines.push(`${name}: ${value}`);
  }
  return Buffer.from(`${requestLine}${headerLines.join("\r\n")}\r\n\r\n`, "latin1");
}

function destroyBoth(left: Duplex, right: Duplex): void {
  left.destroy();
  right.destroy();
}

export async function startLocalWebSocketTlsProxy(
  options: LocalTlsProxyOptions
): Promise<{ readonly port: number; close(): Promise<void> }> {
  validatePort(options.listenPort, true);
  validatePort(options.upstreamPort, false);
  const [key, certificate] = await Promise.all([
    readFile(options.keyPath),
    readFile(options.certificatePath)
  ]);
  const openSockets = new Set<Duplex>();
  const server = createServer({ key, cert: certificate }, (_request, response) => {
    response.writeHead(404, { Connection: "close" });
    response.end();
  });

  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
  });
  server.on("upgrade", (request, clientSocket, head) => {
    const upstream = connect(options.upstreamPort, options.upstreamHost);
    openSockets.add(upstream);
    upstream.once("close", () => openSockets.delete(upstream));
    upstream.setTimeout(PROXY_SOCKET_TIMEOUT_MILLISECONDS, () =>
      destroyBoth(clientSocket, upstream)
    );
    clientSocket.setTimeout(PROXY_SOCKET_TIMEOUT_MILLISECONDS, () =>
      destroyBoth(clientSocket, upstream)
    );
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstream.destroy());
    upstream.once("connect", () => {
      upstream.write(serializeUpgradeRequest(request));
      if (head.byteLength > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, options.listenHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Local TLS proxy did not bind a TCP port.");
  }

  let closed = false;
  return {
    port: address.port,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of openSockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}
