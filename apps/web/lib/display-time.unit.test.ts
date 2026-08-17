import { describe, expect, it } from "vitest";

import { formatUtcDate, formatUtcDateTime, formatUtcFullDateTime } from "./display-time.ts";

describe("deterministic display time", () => {
  it("uses UTC on both sides of local midnight", () => {
    expect(formatUtcDate("2026-08-11T01:30:00.000Z")).toBe("Aug 11");
    expect(formatUtcDateTime("2026-08-11T01:30:00.000Z")).toBe("Aug 11, 1:30 AM UTC");
    expect(formatUtcFullDateTime("2026-08-11T01:30:00.000Z")).toBe("Aug 11, 2026, 1:30 AM UTC");
  });

  it("accepts Date values without mutating them", () => {
    const value = new Date("2026-08-11T23:45:00.000Z");

    expect(formatUtcDate(value)).toBe("Aug 11");
    expect(value.toISOString()).toBe("2026-08-11T23:45:00.000Z");
  });

  it("rejects invalid instants instead of inventing a date", () => {
    expect(() => formatUtcDate("not-an-instant")).toThrow("display instant");
    expect(() => formatUtcDate(new Date(Number.NaN))).toThrow("display instant");
  });
});
