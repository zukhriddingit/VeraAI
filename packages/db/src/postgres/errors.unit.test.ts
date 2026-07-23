import { describe, expect, it } from "vitest";

import { mapPostgresError, safePostgresErrorFields } from "./errors.ts";

describe("PostgreSQL error mapping", () => {
  it.each([
    ["23505", "conflict", false],
    ["23503", "ownership_violation", false],
    ["40001", "serialization", true],
    ["57014", "timeout", true],
    ["ECONNREFUSED", "unavailable", true]
  ] as const)("maps %s safely", (code, category, retryable) => {
    const mapped = mapPostgresError({
      code,
      detail: "postgresql://vera:secret@example.test/private",
      parameters: ["synthetic-refresh-token"]
    });

    expect(mapped).toMatchObject({ category, retryable });
    expect(mapped.message).not.toContain("secret");
    expect(mapped.message).not.toContain("synthetic-refresh-token");
    expect(safePostgresErrorFields(mapped)).toEqual({ category, retryable });
  });

  it("unwraps driver errors without exposing their details", () => {
    const mapped = mapPostgresError({
      message: "query failed",
      cause: {
        code: "23503",
        detail: "synthetic-refresh-token"
      }
    });

    expect(mapped).toMatchObject({ category: "ownership_violation", retryable: false });
    expect(mapped.message).not.toContain("synthetic-refresh-token");
  });
});
