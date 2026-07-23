import { describe, expect, it } from "vitest";

import { OperatorAuthorizationError, requireOperator } from "./operator-auth.ts";

const USER = "018f9f64-7b5a-7c91-a12e-123456789abc";

describe("operator authorization", () => {
  it("denies an ordinary renter and allows only an exact configured user id", () => {
    expect(() => requireOperator(USER, {})).toThrow(OperatorAuthorizationError);
    expect(requireOperator(USER, { VERA_OPERATOR_USER_IDS: USER })).toBe(USER);
    expect(() =>
      requireOperator(USER, { VERA_OPERATOR_USER_IDS: "018f9f64-7b5a-7c91-a12e-123456789abd" })
    ).toThrow(OperatorAuthorizationError);
  });
});
