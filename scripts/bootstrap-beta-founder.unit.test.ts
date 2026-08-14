import { describe, expect, it } from "vitest";

import { parseFounderBootstrap } from "./bootstrap-beta-founder.ts";

const founderId = "018f9f64-7b5a-7c91-a12e-111111111111";

describe("founder beta bootstrap confirmation", () => {
  it("requires the exact confirmed UUID to be in the exact admin list", () => {
    expect(
      parseFounderBootstrap({
        arguments_: ["--confirm", founderId],
        environment: { VERA_BETA_ADMIN_USER_IDS: founderId }
      })
    ).toBe(founderId);
    expect(() =>
      parseFounderBootstrap({
        arguments_: ["--confirm", founderId],
        environment: { VERA_BETA_ADMIN_USER_IDS: "018f9f64-7b5a-7c91-a12e-222222222222" }
      })
    ).toThrow();
  });

  it("rejects missing, extra, and malformed confirmation input", () => {
    const environment = { VERA_BETA_ADMIN_USER_IDS: founderId };
    expect(() => parseFounderBootstrap({ arguments_: [], environment })).toThrow();
    expect(() =>
      parseFounderBootstrap({ arguments_: ["--confirm", "not-a-uuid"], environment })
    ).toThrow();
    expect(() =>
      parseFounderBootstrap({ arguments_: ["--confirm", founderId, "extra"], environment })
    ).toThrow();
  });
});
