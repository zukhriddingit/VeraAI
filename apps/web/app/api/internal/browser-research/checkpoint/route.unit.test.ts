import { describe, expect, it } from "vitest";

import { validCheckpointBearer } from "./route.ts";

describe("validCheckpointBearer", () => {
  it("accepts only an exact bearer credential", () => {
    const expected = "a".repeat(32);
    expect(validCheckpointBearer(`Bearer ${expected}`, expected)).toBe(true);
    expect(validCheckpointBearer(`Bearer ${"b".repeat(32)}`, expected)).toBe(false);
    expect(validCheckpointBearer(`Bearer ${"a".repeat(31)}`, expected)).toBe(false);
    expect(validCheckpointBearer(null, expected)).toBe(false);
  });
});
