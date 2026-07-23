import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadinessReport } from "@vera/domain";

import {
  clearApplicationForTesting,
  registerApplication,
  type VeraApplication
} from "../../../lib/server/application-registry.ts";
import { createUnconfiguredCalendarApplication } from "../../../lib/server/calendar-application.ts";
import { GET } from "./route.ts";

afterEach(clearApplicationForTesting);

function register(status: "ready" | "not_ready"): void {
  registerApplication({
    mode: "hosted",
    repositoryProvider: {} as VeraApplication["repositoryProvider"],
    auth: null,
    calendar: createUnconfiguredCalendarApplication(),
    gmailOAuth: null,
    demoUserId: null,
    readiness: vi.fn(async (): Promise<ReadinessReport> => ({
      service: "vera-web",
      status,
      checkedAt: "2026-07-20T12:00:00.000Z",
      database: {
        status: status === "ready" ? "ready" : "migration_behind",
        migration: status === "ready" ? "current" : "behind"
      }
    })),
    close: vi.fn()
  });
}

describe("GET /api/ready", () => {
  it("distinguishes ready from migration-behind without connection details", async () => {
    register("ready");
    const ready = await GET();
    expect(ready.status).toBe(200);
    expect(JSON.stringify(await ready.json())).not.toMatch(/postgres|database_url|password/iu);

    clearApplicationForTesting();
    register("not_ready");
    const behind = await GET();
    expect(behind.status).toBe(503);
    expect(await behind.json()).toMatchObject({
      status: "not_ready",
      database: { status: "migration_behind", migration: "behind" }
    });
  });
});
