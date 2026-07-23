import type { ProductionSchedule, VeraUserId } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { reconcileNextProductionSchedule } from "./maritime-scheduler.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const NOW = new Date("2026-07-22T12:00:00.000Z");
const schedule: ProductionSchedule = {
  id: "schedule-1",
  userId: USER_ID,
  kind: "notification_fanout",
  state: "enabled",
  intervalSeconds: 300,
  sourceConfigurationId: null,
  nextRunAt: "2026-07-22T12:05:00.000Z",
  lastRunAt: NOW.toISOString(),
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString()
};

describe("Maritime schedule reconciliation", () => {
  it("creates and executes one deterministic run", async () => {
    const createRun = vi.fn(async (run) => ({ record: run, inserted: true }));
    const transitionRun = vi.fn(async (_id, _expected, requested, at) => ({
      id: "run-1",
      userId: USER_ID,
      scheduleId: schedule.id,
      state: requested,
      dueAt: NOW.toISOString(),
      idempotencyKey: "a".repeat(64),
      sourceJobId: null,
      attemptCount: 1,
      safeErrorCode: null,
      startedAt: at,
      completedAt: requested === "completed" ? at : null,
      createdAt: at,
      updatedAt: at
    }));
    const handler = vi.fn(async () => ({ status: "completed" as const }));
    await expect(
      reconcileNextProductionSchedule({
        queue: { claimNextProductionSchedule: vi.fn(async () => ({ userId: USER_ID, schedule })) },
        repositoriesForUser: () => ({ productionSchedules: { createRun, transitionRun } }),
        handler,
        now: () => NOW,
        createId: () => "run-1"
      })
    ).resolves.toMatchObject({ status: "completed", scheduleKind: "notification_fanout" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not execute an idempotent replay", async () => {
    const handler = vi.fn();
    await expect(
      reconcileNextProductionSchedule({
        queue: { claimNextProductionSchedule: vi.fn(async () => ({ userId: USER_ID, schedule })) },
        repositoriesForUser: () => ({
          productionSchedules: {
            createRun: vi.fn(async (run) => ({ record: run, inserted: false })),
            transitionRun: vi.fn()
          }
        }),
        handler,
        now: () => NOW,
        createId: () => "run-replay"
      })
    ).resolves.toMatchObject({ status: "replayed" });
    expect(handler).not.toHaveBeenCalled();
  });
});
