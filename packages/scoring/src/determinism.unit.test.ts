import { describe, expect, it } from "vitest";

import { canonicalJson, sha256Canonical, stableEntityId } from "./determinism.ts";

describe("deterministic serialization", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 }, list: [2, 1] })).toBe(
      '{"a":{"b":3,"y":2},"list":[2,1],"z":1}'
    );
  });

  it("produces stable hashes and safe IDs", () => {
    expect(sha256Canonical({ b: 2, a: 1 })).toBe(sha256Canonical({ a: 1, b: 2 }));
    expect(stableEntityId("pair", { a: 1 })).toMatch(/^pair:[a-f0-9]{32}$/u);
  });

  it("rejects non-JSON-safe values instead of silently coercing them", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/iu);
    expect(() => canonicalJson({ value: undefined })).toThrow(/undefined/iu);
  });
});
