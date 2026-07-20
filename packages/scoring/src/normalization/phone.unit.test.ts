import { describe, expect, it } from "vitest";

import { normalizeEmail, normalizeUsPhone } from "./phone.ts";

describe("normalizeUsPhone", () => {
  it.each([
    ["(617) 555-0123", "+16175550123", null],
    ["1-617-555-0123 ext. 44", "+16175550123", "44"],
    ["617.555.0123 x9", "+16175550123", "9"]
  ] as const)("normalizes %s without guessing", (input, e164, extension) => {
    expect(normalizeUsPhone(input)).toEqual({ status: "known", e164, extension });
  });

  it.each(["555-0123", "+44 20 7946 0958", "161755501234", "call me"])(
    "rejects ambiguous or unsupported input %s",
    (input) => {
      expect(normalizeUsPhone(input).status).toBe("unknown");
    }
  );

  it("rejects ambiguous extension syntax", () => {
    expect(normalizeUsPhone("617-555-0123 ext 4 ext 5")).toEqual({
      status: "unknown",
      reason: "ambiguous_extension"
    });
  });
});

describe("normalizeEmail", () => {
  it("normalizes an explicit supplied address", () => {
    expect(normalizeEmail(" RENTER.TEST+fixture@Example.COM ")).toEqual({
      status: "known",
      email: "renter.test+fixture@example.com"
    });
  });

  it.each(["", "missing-at.example.com", "a@localhost", "a b@example.com"])(
    "rejects malformed email %s",
    (input) => expect(normalizeEmail(input).status).toBe("unknown")
  );
});
