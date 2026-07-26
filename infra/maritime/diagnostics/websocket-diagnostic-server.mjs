import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { WebSocketServer } from "ws";

const CREDENTIAL_PROTOCOL_PREFIX = "openclaw-extension-token.";
const SAFE_PROTOCOL = /^[A-Za-z0-9._-]{1,64}$/u;
const SAFE_PATH = /^\/[A-Za-z0-9/_-]{1,160}$/u;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function firstHeader(value) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function originScheme(origin) {
  if (!origin) return null;
  try {
    const protocol = new URL(origin).protocol;
    if (protocol === "chrome-extension:") return "chrome-extension";
    if (protocol === "https:") return "https";
    if (protocol === "http:") return "http";
    return "other";
  } catch {
    return "other";
  }
}

function sanitizeOfferedProtocols(header) {
  const protocols = firstHeader(header)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    protocolCount: protocols.length,
    nonSecretProtocols: protocols.filter(
      (protocol) => !protocol.startsWith(CREDENTIAL_PROTOCOL_PREFIX)
    ),
    credentialProtocolSha256: protocols.flatMap((protocol) =>
      protocol.startsWith(CREDENTIAL_PROTOCOL_PREFIX) ? [sha256(protocol)] : []
    )
  };
}

function writeHttpDenial(socket, statusLine) {
  socket.end(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
}

function validateOptions(options) {
  if (options.host !== "127.0.0.1" && options.host !== "0.0.0.0") {
    throw new Error("Diagnostic host must be loopback or all interfaces.");
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("Diagnostic port must be a valid TCP port.");
  }
  if (!SAFE_PATH.test(options.acceptedPath)) {
    throw new Error("Diagnostic path must be one exact safe path.");
  }
  if (
    !SAFE_PROTOCOL.test(options.selectedProtocol) ||
    options.selectedProtocol.startsWith(CREDENTIAL_PROTOCOL_PREFIX)
  ) {
    throw new Error("Diagnostic response protocol must be harmless and bounded.");
  }
  if (
    !Number.isSafeInteger(options.maxPayloadBytes) ||
    options.maxPayloadBytes < 64 ||
    options.maxPayloadBytes > 65_536
  ) {
    throw new Error("Diagnostic maximum payload must be from 64 through 65536 bytes.");
  }
  if (
    !Number.isSafeInteger(options.idleTimeoutMilliseconds) ||
    options.idleTimeoutMilliseconds < 100 ||
    options.idleTimeoutMilliseconds > 60_000
  ) {
    throw new Error("Diagnostic idle timeout must be from 100 through 60000 milliseconds.");
  }
  if (
    !Array.isArray(options.allowedOriginSchemes) ||
    options.allowedOriginSchemes.some(
      (scheme) => !["chrome-extension", "https", "http"].includes(scheme)
    )
  ) {
    throw new Error("Diagnostic Origin schemes must use the closed allowlist.");
  }
}

export async function startDiagnosticWebSocketServer(options) {
  validateOptions(options);
  const clients = new Set();
  const server = createServer((_request, response) => {
    response.writeHead(404, { Connection: "close" });
    response.end();
  });
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes,
    handleProtocols(protocols) {
      return protocols.has(options.selectedProtocol) ? options.selectedProtocol : false;
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const rawUrl = request.url ?? "/";
    let parsed;
    try {
      parsed = new URL(rawUrl, "http://127.0.0.1");
    } catch {
      parsed = null;
    }
    const pathAccepted =
      parsed !== null &&
      parsed.pathname === options.acceptedPath &&
      parsed.search === "" &&
      parsed.hash === "";
    const origin = firstHeader(request.headers.origin);
    const scheme = originScheme(origin);
    const originAccepted =
      (scheme === null && options.allowMissingOrigin === true) ||
      (scheme !== null && options.allowedOriginSchemes.includes(scheme));
    const protocolSummary = sanitizeOfferedProtocols(request.headers["sec-websocket-protocol"]);
    options.writeObservation({
      event: "upgrade_observed",
      pathClass: pathAccepted ? "accepted" : "invalid",
      originPresent: origin.length > 0,
      originScheme: scheme,
      ...protocolSummary,
      reachedContainer: true
    });
    if (!pathAccepted) {
      writeHttpDenial(socket, "404 Not Found");
      return;
    }
    if (!originAccepted) {
      writeHttpDenial(socket, "403 Forbidden");
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit("connection", webSocket, request);
    });
  });

  webSockets.on("connection", (webSocket) => {
    clients.add(webSocket);
    const connectedAt = Date.now();
    const idleTimer = setTimeout(() => {
      webSocket.close(1001, "bounded-idle-timeout");
    }, options.idleTimeoutMilliseconds);
    webSocket.ping();
    webSocket.on("pong", () => {
      options.writeObservation({ event: "pong_observed", reachedContainer: true });
    });
    webSocket.on("message", (value, binary) => {
      webSocket.send(value, { binary });
    });
    webSocket.on("error", (error) => {
      options.writeObservation({
        event: "connection_error",
        errorCode:
          error && typeof error === "object" && typeof error.code === "string"
            ? error.code
            : "unknown",
        reachedContainer: true
      });
    });
    webSocket.once("close", (closeCode) => {
      clearTimeout(idleTimer);
      clients.delete(webSocket);
      options.writeObservation({
        event: "connection_closed",
        lifetimeMilliseconds: Math.max(0, Date.now() - connectedAt),
        closeCode,
        reachedContainer: true
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Diagnostic server did not bind a TCP port.");
  }

  let closed = false;
  return {
    port: address.port,
    async close() {
      if (closed) return;
      closed = true;
      for (const client of clients) client.terminate();
      await new Promise((resolve, reject) =>
        webSockets.close((webSocketError) => {
          if (webSocketError) {
            reject(webSocketError);
            return;
          }
          server.close((serverError) => (serverError ? reject(serverError) : resolve()));
        })
      );
    }
  };
}

async function main() {
  const port = Number(process.env.VERA_DIAGNOSTIC_PORT ?? process.env.PORT ?? "18080");
  const server = await startDiagnosticWebSocketServer({
    host: "0.0.0.0",
    port,
    acceptedPath: "/browser/extension",
    allowedOriginSchemes: ["chrome-extension", "https"],
    allowMissingOrigin: true,
    selectedProtocol: "vera-diag-one",
    maxPayloadBytes: 65_536,
    idleTimeoutMilliseconds: 40_000,
    writeObservation(value) {
      process.stdout.write(`${JSON.stringify(value)}\n`);
    }
  });
  process.stdout.write(`${JSON.stringify({ event: "diagnostic_ready", port: server.port })}\n`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
