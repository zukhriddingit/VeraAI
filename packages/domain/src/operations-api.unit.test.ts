import { describe, expect, it } from "vitest";

import { OperationsSnapshotSchema } from "./operations-api.ts";

const NOW = "2026-07-22T12:00:00.000Z";

describe("operations API", () => {
  it("exposes bounded safe health and count projections", () => {
    expect(
      OperationsSnapshotSchema.parse({
        generatedAt: NOW,
        worker: { status: "ready", checkedAt: NOW, safeCode: null },
        maritime: { status: "running", checkedAt: NOW, diagnosticUrl: null, safeCode: null },
        gateway: {
          status: "running",
          version: "2026.6.33",
          checkedAt: NOW,
          safeCode: null
        },
        browserNode: null,
        schedules: [],
        jobCounts: {
          queued: 0,
          running: 0,
          deferred: 0,
          manualAction: 0,
          deadLetter: 0
        },
        notificationCounts: { queued: 0, delivered: 0, failed: 0 },
        killSwitches: []
      })
    ).toMatchObject({ worker: { status: "ready" } });
  });

  it("rejects secrets and unbounded diagnostic fields", () => {
    const unsafe = {
      generatedAt: NOW,
      worker: { status: "ready", checkedAt: NOW, safeCode: null, token: "secret" },
      maritime: { status: "running", checkedAt: NOW, diagnosticUrl: null, safeCode: null },
      gateway: {
        status: "running",
        version: "2026.6.33",
        checkedAt: NOW,
        safeCode: null
      },
      browserNode: null,
      schedules: [],
      jobCounts: { queued: 0, running: 0, deferred: 0, manualAction: 0, deadLetter: 0 },
      notificationCounts: { queued: 0, delivered: 0, failed: 0 },
      killSwitches: []
    };
    expect(() => OperationsSnapshotSchema.parse(unsafe)).toThrow();
  });
});
