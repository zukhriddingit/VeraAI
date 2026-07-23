import { describe, expect, it } from "vitest";
import { evaluateQuietHours } from "./quiet-hours.ts";

describe("quiet hours", () => {
  it("uses the user's timezone across the DST fall-back hour", () => {
    expect(
      evaluateQuietHours("2026-11-01T05:30:00.000Z", "America/New_York", "22:00", "07:00").quiet
    ).toBe(true);
    expect(
      evaluateQuietHours("2026-11-01T12:30:00.000Z", "America/New_York", "22:00", "07:00").quiet
    ).toBe(false);
  });
});
