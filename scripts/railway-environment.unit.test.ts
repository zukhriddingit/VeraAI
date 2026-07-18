import { describe, expect, it, vi } from "vitest";

import { resolveRailwayConfiguration } from "./railway-environment.ts";

function passingChecks() {
  return {
    expectedMountPath: "/data",
    assertDirectory: vi.fn(),
    assertReadableWritable: vi.fn()
  };
}

describe("Railway environment", () => {
  it.each([
    [{ PORT: "3000" }, "Railway volume mount is required"],
    [
      { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "relative/data" },
      "Railway volume mount must be absolute"
    ],
    [
      { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "/tmp/data" },
      "Railway volume must be mounted at /data"
    ]
  ])("rejects invalid storage configuration", (environment, message) => {
    expect(() => resolveRailwayConfiguration(environment, passingChecks())).toThrow(message);
  });

  it.each(["", "0", "65536", "abc", "3000.5"])("rejects invalid PORT %s", (port) => {
    expect(() =>
      resolveRailwayConfiguration(
        { PORT: port, RAILWAY_VOLUME_MOUNT_PATH: "/data" },
        passingChecks()
      )
    ).toThrow("Railway PORT must be an integer between 1 and 65535");
  });

  it("forces demo mode and removes live model configuration", () => {
    const configuration = resolveRailwayConfiguration(
      {
        PORT: "3000",
        RAILWAY_VOLUME_MOUNT_PATH: "/data",
        OPENAI_API_KEY: "not-a-real-key",
        VERA_LLM_MODEL: "live-model",
        VERA_LLM_TIMEOUT_MS: "1000",
        VERA_DEMO_DATA_DIR: "/tmp/override"
      },
      passingChecks()
    );

    expect(configuration).toMatchObject({ dataDirectory: "/data", port: 3000 });
    expect(configuration.childEnvironment).toMatchObject({
      VERA_DATA_DIR: "/data",
      VERA_DEMO_MODE: "1",
      NEXT_TELEMETRY_DISABLED: "1"
    });
    expect(configuration.childEnvironment.OPENAI_API_KEY).toBeUndefined();
    expect(configuration.childEnvironment.VERA_LLM_MODEL).toBeUndefined();
    expect(configuration.childEnvironment.VERA_LLM_TIMEOUT_MS).toBeUndefined();
    expect(configuration.childEnvironment.VERA_DEMO_DATA_DIR).toBeUndefined();
  });

  it("checks the mounted directory before returning configuration", () => {
    const checks = passingChecks();

    resolveRailwayConfiguration({ PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "/data" }, checks);

    expect(checks.assertDirectory).toHaveBeenCalledWith("/data");
    expect(checks.assertReadableWritable).toHaveBeenCalledWith("/data");
  });

  it("fails closed when the volume cannot be accessed", () => {
    expect(() =>
      resolveRailwayConfiguration(
        { PORT: "3000", RAILWAY_VOLUME_MOUNT_PATH: "/data" },
        {
          ...passingChecks(),
          assertReadableWritable() {
            throw new Error("unwritable");
          }
        }
      )
    ).toThrow("Railway volume is unavailable or not writable");
  });
});
