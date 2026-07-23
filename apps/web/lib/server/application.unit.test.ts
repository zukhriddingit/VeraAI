import { describe, expect, it, vi } from "vitest";

import { installHostedApplicationShutdown, type ShutdownTarget } from "./application.ts";

function createShutdownTarget() {
  const listeners = new Map<string, () => void>();
  const exit = vi.fn();
  const target: ShutdownTarget = {
    once(signal, listener) {
      listeners.set(signal, listener);
    },
    removeListener(signal, listener) {
      if (listeners.get(signal) === listener) listeners.delete(signal);
    },
    exit
  };
  return { exit, listeners, target };
}

describe("hosted application shutdown", () => {
  it("closes the shared pool once before exiting successfully", async () => {
    const close = vi.fn(async () => {});
    const { exit, listeners, target } = createShutdownTarget();
    installHostedApplicationShutdown({ close }, target);

    listeners.get("SIGTERM")?.();
    listeners.get("SIGINT")?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

    expect(close).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("exits unsuccessfully when pool shutdown fails", async () => {
    const close = vi.fn(async () => {
      throw new Error("synthetic close failure");
    });
    const { exit, listeners, target } = createShutdownTarget();
    installHostedApplicationShutdown({ close }, target);

    listeners.get("SIGTERM")?.();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    expect(close).toHaveBeenCalledTimes(1);
  });
});
