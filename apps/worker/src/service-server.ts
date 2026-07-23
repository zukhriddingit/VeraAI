import { createServer, type Server } from "node:http";

import { createHealthReport, type ReadinessReport } from "@vera/domain";

export function createLivenessPayload(input: {
  readonly version: string;
  readonly nodeVersion: string;
  readonly now: Date;
}) {
  return createHealthReport({
    service: "vera-worker",
    version: input.version,
    now: input.now,
    nodeVersion: input.nodeVersion
  });
}

export async function createReadinessPayload(
  readiness: () => Promise<ReadinessReport>
): Promise<ReadinessReport> {
  return readiness();
}

export interface WorkerServiceServerOptions {
  readonly port: number;
  readonly host?: string;
  readonly version: string;
  readonly nodeVersion: string;
  readonly now: () => Date;
  readonly readiness: () => Promise<ReadinessReport>;
  readonly metrics?: () => string;
}

export function createWorkerServiceServer(options: WorkerServiceServerOptions): {
  readonly server: Server;
  start(): Promise<void>;
  close(): Promise<void>;
} {
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      if (request.method !== "GET") {
        response.statusCode = 405;
        response.end(JSON.stringify({ status: "method_not_allowed" }));
        return;
      }
      if (request.url === "/health") {
        response.statusCode = 200;
        response.end(
          JSON.stringify(
            createLivenessPayload({
              version: options.version,
              nodeVersion: options.nodeVersion,
              now: options.now()
            })
          )
        );
        return;
      }
      if (request.url === "/ready") {
        const report = await createReadinessPayload(options.readiness);
        response.statusCode = report.status === "ready" ? 200 : 503;
        response.end(JSON.stringify(report));
        return;
      }
      if (request.url === "/metrics" && options.metrics) {
        response.statusCode = 200;
        response.setHeader(
          "content-type",
          "application/openmetrics-text; version=1.0.0; charset=utf-8"
        );
        response.end(options.metrics());
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ status: "not_found" }));
    })().catch(() => {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ status: "not_ready" }));
    });
  });
  return {
    server,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host ?? "0.0.0.0", () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
