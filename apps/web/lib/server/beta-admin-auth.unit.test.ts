import { describe, expect, it } from "vitest";

import { VeraUserIdSchema } from "@vera/domain";

import { requireBetaAdmin } from "./beta-admin-auth.ts";

const founderId = VeraUserIdSchema.parse("10000000-0000-4000-8000-000000000001");

describe("private beta admin authorization", () => {
  it("requires an exact UUID allowlist membership", () => {
    expect(() =>
      requireBetaAdmin(founderId, { VERA_BETA_ADMIN_USER_IDS: founderId })
    ).not.toThrow();
    expect(() =>
      requireBetaAdmin(founderId, {
        VERA_BETA_ADMIN_USER_IDS: "10000000-0000-4000-8000-000000000002"
      })
    ).toThrow();
  });

  it("fails closed on missing or malformed configuration", () => {
    expect(() => requireBetaAdmin(founderId, {})).toThrow();
    expect(() => requireBetaAdmin(founderId, { VERA_BETA_ADMIN_USER_IDS: "founder" })).toThrow();
  });
});
