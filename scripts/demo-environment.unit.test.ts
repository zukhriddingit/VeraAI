import { describe, expect, it } from "vitest";

import {
  demoEnvironment,
  resolveDemoDataDirectory,
  validateDemoResetTarget
} from "./demo-environment.ts";

describe("demo data directory", () => {
  it("uses a distinct sibling of normal Vera data", () => {
    expect(resolveDemoDataDirectory({}, "darwin", "/Users/demo")).toBe(
      "/Users/demo/Library/Application Support/Vera Demo"
    );
    expect(resolveDemoDataDirectory({}, "linux", "/home/demo")).toBe(
      "/home/demo/.local/share/vera-demo"
    );
  });

  it("honors an explicit demo-only override", () => {
    expect(
      resolveDemoDataDirectory({ VERA_DEMO_DATA_DIR: "/tmp/vera-recording" }, "linux", "/home/demo")
    ).toBe("/tmp/vera-recording");
  });

  it("rejects broad, working, and production reset targets", () => {
    const options = { homeDirectory: "/Users/demo", workingDirectory: "/workspace/vera" };

    expect(() =>
      validateDemoResetTarget(
        "/Users/demo",
        "/Users/demo/Library/Application Support/Vera",
        options
      )
    ).toThrow("Unsafe demo reset target");
    expect(() =>
      validateDemoResetTarget(
        "/Users/demo/Library/Application Support/Vera",
        "/Users/demo/Library/Application Support/Vera",
        options
      )
    ).toThrow("Unsafe demo reset target");
    expect(() =>
      validateDemoResetTarget("/workspace", "/Users/demo/Library/Application Support/Vera", options)
    ).toThrow("Unsafe demo reset target");
    expect(
      validateDemoResetTarget(
        "/Users/demo/Library/Application Support/Vera Demo",
        "/Users/demo/Library/Application Support/Vera",
        options
      )
    ).toBe("/Users/demo/Library/Application Support/Vera Demo");
  });

  it("forces local deterministic mode and removes live model configuration", () => {
    const environment = demoEnvironment({
      VERA_DEMO_DATA_DIR: "/tmp/vera-recording",
      OPENAI_API_KEY: "not-a-real-key",
      VERA_LLM_MODEL: "example-model",
      VERA_LLM_TIMEOUT_MS: "1000"
    });

    expect(environment).toMatchObject({
      VERA_DEMO_MODE: "1",
      VERA_DATA_DIR: "/tmp/vera-recording",
      NEXT_TELEMETRY_DISABLED: "1"
    });
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.VERA_LLM_MODEL).toBeUndefined();
    expect(environment.VERA_LLM_TIMEOUT_MS).toBeUndefined();
  });
});
