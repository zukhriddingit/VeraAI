import { HealthReportSchema } from "@vera/domain";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns a schema-valid local web health report", async () => {
    const response = GET();
    const payload: unknown = await response.json();
    const report = HealthReportSchema.parse(payload);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(report).toMatchObject({
      service: "vera-web",
      status: "ok",
      version: "0.1.0"
    });
    expect(report.runtime.node).toBe(process.versions.node);
  });
});
