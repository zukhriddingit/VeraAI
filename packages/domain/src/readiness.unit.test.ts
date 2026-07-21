import { describe, expect, it } from "vitest";

import { ReadinessReportSchema } from "./readiness.ts";

describe("readiness reports", () => {
  it("distinguishes liveness from database readiness", () => {
    expect(
      ReadinessReportSchema.parse({
        service: "vera-web",
        status: "not_ready",
        checkedAt: "2026-07-20T12:00:00.000Z",
        database: { status: "unavailable", migration: "unknown" }
      }).status
    ).toBe("not_ready");
  });

  it("accepts ready only with a current schema", () => {
    expect(
      ReadinessReportSchema.parse({
        service: "vera-worker",
        status: "ready",
        checkedAt: "2026-07-20T12:00:00.000Z",
        database: { status: "ready", migration: "current" }
      }).status
    ).toBe("ready");
  });

  it("rejects contradictory states", () => {
    expect(() =>
      ReadinessReportSchema.parse({
        service: "vera-web",
        status: "ready",
        checkedAt: "2026-07-20T12:00:00.000Z",
        database: { status: "migration_behind", migration: "behind" }
      })
    ).toThrow("Readiness must match");
  });
});
