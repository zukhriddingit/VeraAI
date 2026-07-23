import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createWorkerMetrics } from "./metrics.ts";
import {
  createLivenessPayload,
  createReadinessPayload,
  createWorkerServiceServer
} from "./service-server.ts";

describe("worker service health", () => {
  it("keeps liveness independent from PostgreSQL and free of environment secrets", () => {
    const payload = createLivenessPayload({
      version: "0.1.0",
      nodeVersion: "24.0.0",
      now: new Date("2026-07-22T12:00:00.000Z")
    });
    expect(payload).toMatchObject({ service: "vera-worker", status: "ok" });
    expect(JSON.stringify(payload)).not.toMatch(/DATABASE_URL|token|secret|cookie/iu);
  });

  it("returns a distinct database readiness projection", async () => {
    await expect(
      createReadinessPayload(async () => ({
        service: "vera-worker",
        status: "ready",
        checkedAt: "2026-07-22T12:00:00.000Z",
        database: { status: "ready", migration: "current" }
      }))
    ).resolves.toMatchObject({ status: "ready", database: { migration: "current" } });
  });

  it("serves exact private health, readiness, and metrics routes without secrets", async () => {
    const metrics = createWorkerMetrics();
    const service = createWorkerServiceServer({
      port: 0,
      host: "127.0.0.1",
      version: "0.1.0",
      nodeVersion: "24.0.0",
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      readiness: async () => ({
        service: "vera-worker",
        status: "not_ready",
        checkedAt: "2026-07-22T12:00:00.000Z",
        database: { status: "unavailable", migration: "unknown" }
      }),
      metrics: () => metrics.render()
    });
    await service.start();
    try {
      const address = service.server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      const health = await fetch(`${origin}/health`);
      const ready = await fetch(`${origin}/ready`);
      const metricResponse = await fetch(`${origin}/metrics`);
      const unknown = await fetch(`${origin}/unknown`);
      const wrongMethod = await fetch(`${origin}/health`, { method: "POST" });

      expect(health.status).toBe(200);
      expect(ready.status).toBe(503);
      expect(metricResponse.status).toBe(200);
      expect(metricResponse.headers.get("content-type")).toBe(
        "application/openmetrics-text; version=1.0.0; charset=utf-8"
      );
      expect(await metricResponse.text()).toContain("vera_worker_ready");
      expect(unknown.status).toBe(404);
      expect(wrongMethod.status).toBe(405);
      const bodies = await Promise.all([
        health.text(),
        ready.text(),
        unknown.text(),
        wrongMethod.text()
      ]);
      for (const forbidden of [
        "postgresql://vera:secret@example.test/vera",
        "maritime-secret",
        "openclaw-secret",
        "credential-keyring-secret"
      ]) {
        expect(bodies.join("\n")).not.toContain(forbidden);
      }
    } finally {
      await service.close();
    }
  });

  it("returns only a fixed not-ready body when readiness throws", async () => {
    const service = createWorkerServiceServer({
      port: 0,
      host: "127.0.0.1",
      version: "0.1.0",
      nodeVersion: "24.0.0",
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      readiness: async () => {
        throw new Error("postgresql://vera:secret@example.test/vera");
      }
    });
    await service.start();
    try {
      const address = service.server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ status: "not_ready" });
    } finally {
      await service.close();
    }
  });
});
