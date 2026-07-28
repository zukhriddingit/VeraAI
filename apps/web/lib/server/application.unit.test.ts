import { describe, expect, it, vi } from "vitest";

import {
  composeHostedGoogleIntegrations,
  installHostedApplicationShutdown,
  type ShutdownTarget
} from "./application.ts";

const googleConfiguration = {
  clientId: "synthetic-client-id",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://vera.example.test/api/integrations/google/calendar/callback",
  gmailRedirectUri: "https://vera.example.test/api/integrations/google/gmail/callback",
  publicBaseUrl: "https://vera.example.test",
  oauthStateTtlMilliseconds: 600_000,
  providerTimeoutMilliseconds: 5_000,
  credentialKeyProvider: {} as never
} as const;

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

describe("hosted Google integration composition", () => {
  it("uses the lightweight fail-closed adapter without constructing configured bindings", () => {
    const createBindings = vi.fn();

    const result = composeHostedGoogleIntegrations({
      configuration: null,
      repositoryProvider: {} as never,
      createBindings
    });

    expect(result.calendar).toMatchObject({
      configurationState: "unconfigured",
      oauth: null
    });
    expect(result.gmailOAuth).toBeNull();
    expect(createBindings).not.toHaveBeenCalled();
  });

  it("uses the Calendar and Gmail facades from one configured binding", () => {
    const bindings = {
      calendar: { configurationState: "configured", oauth: {}, createClient: vi.fn() },
      gmailOAuth: { createAuthorization: vi.fn() }
    } as never;
    const createBindings = vi.fn(() => bindings);
    const repositoryProvider = {} as never;

    const result = composeHostedGoogleIntegrations({
      configuration: googleConfiguration,
      repositoryProvider,
      createBindings
    });

    expect(result).toBe(bindings);
    expect(createBindings).toHaveBeenCalledOnce();
    expect(createBindings).toHaveBeenCalledWith({
      configuration: googleConfiguration,
      repositoryProvider
    });
  });
});
