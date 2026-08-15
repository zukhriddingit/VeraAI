import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

import { ENROLLMENT_PROTOCOL, handleEnrollmentUpgrade } from "./remote-extension-enrollment.mjs";

const EXTENSION_ROUTE = "/browser/extension";
const PUBLIC_GATEWAY_HOST = "0.0.0.0";
const PUBLIC_GATEWAY_PORT = 18789;
const INTERNAL_GATEWAY_HOST = "127.0.0.1";
const INTERNAL_GATEWAY_PORT = 18790;
const MAX_HEADER_BYTES = 16 * 1024;
const SOCKET_TIMEOUT_MILLISECONDS = 40_000;

function validatePort(value, allowEphemeral) {
  const minimum = allowEphemeral ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum || value > 65_535) {
    throw new Error("Remote extension route-filter ports must be valid TCP ports.");
  }
}

function validateOptions(options) {
  if (options.listenHost !== "127.0.0.1" && options.listenHost !== PUBLIC_GATEWAY_HOST) {
    throw new Error("Route-filter listen host must be loopback or all interfaces.");
  }
  if (options.upstreamHost !== INTERNAL_GATEWAY_HOST) {
    throw new Error("Route-filter upstream must remain loopback-only.");
  }
  validatePort(options.listenPort, true);
  validatePort(options.upstreamPort, false);
}

function serializeUpgradeRequest(request) {
  const requestLine = `${request.method ?? "GET"} ${request.url ?? "/"} HTTP/${request.httpVersion}\r\n`;
  const headerLines = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index];
    const value = request.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) headerLines.push(`${name}: ${value}`);
  }
  return Buffer.from(`${requestLine}${headerLines.join("\r\n")}\r\n\r\n`, "latin1");
}

function denyUpgrade(socket, statusLine) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
}

export function requestedWebSocketProtocols(request) {
  const header = request.headers["sec-websocket-protocol"];
  if (typeof header !== "string") return [];
  return header
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function destroyBoth(left, right) {
  left.destroy();
  right.destroy();
}

export async function startRemoteExtensionRouteFilter(options) {
  validateOptions(options);
  const openSockets = new Set();
  const server = createServer(
    {
      maxHeaderSize: MAX_HEADER_BYTES,
      requestTimeout: 10_000,
      headersTimeout: 10_000
    },
    (request, response) => {
      if (request.method === "GET" && request.url === EXTENSION_ROUTE) {
        response.writeHead(426, {
          Connection: "close",
          "Content-Type": "text/plain; charset=utf-8"
        });
        response.end("Upgrade Required");
        return;
      }
      response.writeHead(404, {
        Connection: "close",
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Not Found");
    }
  );

  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
  });
  server.on("upgrade", (request, clientSocket, head) => {
    if (request.url !== EXTENSION_ROUTE) {
      denyUpgrade(clientSocket, "404 Not Found");
      return;
    }
    const protocols = requestedWebSocketProtocols(request);
    if (protocols.includes(ENROLLMENT_PROTOCOL)) {
      void handleEnrollmentUpgrade(request, clientSocket, head, options.enrollmentDependencies);
      return;
    }
    if (!protocols.includes("openclaw-extension-relay")) {
      denyUpgrade(clientSocket, "400 Bad Request");
      return;
    }
    const upstream = connect(options.upstreamPort, options.upstreamHost);
    openSockets.add(upstream);
    upstream.once("close", () => openSockets.delete(upstream));
    upstream.setTimeout(SOCKET_TIMEOUT_MILLISECONDS, () => destroyBoth(clientSocket, upstream));
    clientSocket.setTimeout(SOCKET_TIMEOUT_MILLISECONDS, () => destroyBoth(clientSocket, upstream));
    upstream.once("error", () => {
      denyUpgrade(clientSocket, "503 Service Unavailable");
      clientSocket.destroy();
    });
    clientSocket.once("error", () => upstream.destroy());
    upstream.once("connect", () => {
      upstream.write(serializeUpgradeRequest(request));
      if (head.byteLength > 0) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, options.listenHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Remote extension route filter did not bind a TCP port.");
  }

  let closed = false;
  return {
    port: address.port,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of openSockets) socket.destroy();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function runGateway() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  if (
    command !== "node" ||
    args.length !== 2 ||
    args[0] !== "openclaw.mjs" ||
    args[1] !== "gateway"
  ) {
    throw new Error("Route filter accepts only the fixed OpenClaw Gateway command.");
  }

  const filter = await startRemoteExtensionRouteFilter({
    listenHost: PUBLIC_GATEWAY_HOST,
    listenPort: PUBLIC_GATEWAY_PORT,
    upstreamHost: INTERNAL_GATEWAY_HOST,
    upstreamPort: INTERNAL_GATEWAY_PORT
  });
  const gateway = spawn(command, args, {
    env: process.env,
    stdio: "inherit"
  });
  process.stdout.write(
    `${JSON.stringify({
      event: "remote_extension_route_filter_ready",
      publicPort: filter.port,
      internalPort: INTERNAL_GATEWAY_PORT
    })}\n`
  );

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    gateway.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  const exit = await new Promise((resolve) => {
    gateway.once("error", () => resolve({ code: 1, signal: null }));
    gateway.once("exit", (code, signal) => resolve({ code, signal }));
  });
  await filter.close();
  if (exit.signal) process.kill(process.pid, exit.signal);
  process.exitCode = exit.code ?? 1;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await runGateway();
}
