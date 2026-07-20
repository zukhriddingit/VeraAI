import { describe, expect, it } from "vitest";

import { dateInTimeZone, normalizeIsoDate, parseExplicitOffsetInstant } from "./date.ts";

describe("normalizeIsoDate", () => {
  it.each(["2024-02-29", "2026-09-01"])("accepts real ISO date %s", (input) => {
    expect(normalizeIsoDate(input)).toBe(input);
  });

  it.each(["2023-02-29", "2026-13-01", "09/01/2026", "September 1"])(
    "rejects ambiguous or impossible date %s",
    (input) => expect(normalizeIsoDate(input)).toBeNull()
  );
});

describe("timezone-safe instant handling", () => {
  it("requires an explicit timestamp offset", () => {
    expect(parseExplicitOffsetInstant("2026-09-01T00:30:00")).toBeNull();
    expect(parseExplicitOffsetInstant("2026-09-01T00:30:00Z")?.toISOString()).toBe(
      "2026-09-01T00:30:00.000Z"
    );
  });

  it("selects the calendar date in the profile timezone", () => {
    expect(dateInTimeZone("2026-09-01T00:30:00Z", "America/New_York")).toBe("2026-08-31");
    expect(dateInTimeZone("2026-03-08T07:30:00Z", "America/New_York")).toBe("2026-03-08");
  });

  it("rejects invalid timezones and offset-free timestamps", () => {
    expect(dateInTimeZone("2026-09-01T00:30:00", "America/New_York")).toBeNull();
    expect(dateInTimeZone("2026-09-01T00:30:00Z", "Mars/Olympus")).toBeNull();
  });
});
