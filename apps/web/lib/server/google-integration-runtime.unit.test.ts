import type { CalendarClient } from "@vera/calendar";
import type { IntegrationConnection } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import type { CalendarApplicationDependencies } from "./calendar-application.ts";
import type { GmailIntegrationOAuth } from "./gmail-integration-oauth.ts";
import {
  GoogleIntegrationOAuthError,
  type GoogleIntegrationOAuth
} from "./google-integration-contracts.ts";
import {
  createLazyGoogleIntegrationBindings,
  type GoogleIntegrationBindings
} from "./google-integration-runtime.ts";

const userId = "018f9f64-7b5a-7c91-a12e-111111111111";
const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy" as const;
const capability = "calendar_conflict_checking" as const;
const returnTo = "/settings/integrations";
const state = "s".repeat(43);
const code = "synthetic-code";
const signal = new AbortController().signal;
const authorization = { authorizationUrl: "https://accounts.example.test/authorize" };
const connection = { id: "synthetic-connection" } as unknown as IntegrationConnection;
const client = { kind: "synthetic-calendar-client" } as unknown as CalendarClient;

const configuration = {
  clientId: "synthetic-client-id",
  clientSecret: "synthetic-client-secret",
  redirectUri: "https://vera.example.test/api/integrations/google/calendar/callback",
  gmailRedirectUri: "https://vera.example.test/api/integrations/google/gmail/callback",
  publicBaseUrl: "https://vera.example.test",
  oauthStateTtlMilliseconds: 600_000,
  providerTimeoutMilliseconds: 5_000,
  credentialKeyProvider: {} as never
} as const;

function createHarness() {
  const calendarSpies = {
    createAuthorization: vi.fn(async () => authorization),
    handleCallback: vi.fn(async () => connection),
    handleDeniedCallback: vi.fn(async () => {}),
    refreshAccessToken: vi.fn(async () => "synthetic-access-token"),
    disconnect: vi.fn(async () => {})
  };
  const calendarOAuth: GoogleIntegrationOAuth = calendarSpies;
  const createClient = vi.fn(async () => client);
  const calendar: CalendarApplicationDependencies = {
    configurationState: "configured",
    oauth: calendarOAuth,
    createClient
  };
  const gmailSpies = {
    createAuthorization: vi.fn(async () => authorization),
    handleCallback: vi.fn(async () => connection),
    handleDeniedCallback: vi.fn(async () => {})
  };
  const gmailOAuth: GmailIntegrationOAuth = gmailSpies;
  const bindings: GoogleIntegrationBindings = { calendar, gmailOAuth };
  const loader = vi.fn(async () => bindings);
  const runtime = createLazyGoogleIntegrationBindings({
    configuration,
    repositoryProvider: {} as never,
    loader
  });
  return {
    bindings,
    calendarSpies,
    createClient,
    gmailSpies,
    loader,
    runtime
  };
}

const operations = [
  {
    name: "Calendar client creation",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.calendar.createClient(userId, freeBusyScope, signal)
      ).resolves.toBe(client);
      expect(harness.createClient).toHaveBeenCalledWith(userId, freeBusyScope, signal);
    }
  },
  {
    name: "Calendar authorization",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.calendar.oauth!.createAuthorization({
          userId,
          capability,
          returnTo
        })
      ).resolves.toBe(authorization);
      expect(harness.calendarSpies.createAuthorization).toHaveBeenCalledWith({
        userId,
        capability,
        returnTo
      });
    }
  },
  {
    name: "Calendar callback",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.calendar.oauth!.handleCallback({ userId, state, code })
      ).resolves.toBe(connection);
      expect(harness.calendarSpies.handleCallback).toHaveBeenCalledWith({
        userId,
        state,
        code
      });
    }
  },
  {
    name: "Calendar denied callback",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.calendar.oauth!.handleDeniedCallback({ userId, state })
      ).resolves.toBeUndefined();
      expect(harness.calendarSpies.handleDeniedCallback).toHaveBeenCalledWith({
        userId,
        state
      });
    }
  },
  {
    name: "Calendar token refresh",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.calendar.oauth!.refreshAccessToken({
          userId,
          requiredScope: freeBusyScope,
          signal
        })
      ).resolves.toBe("synthetic-access-token");
      expect(harness.calendarSpies.refreshAccessToken).toHaveBeenCalledWith({
        userId,
        requiredScope: freeBusyScope,
        signal
      });
    }
  },
  {
    name: "Calendar disconnect",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(harness.runtime.calendar.oauth!.disconnect({ userId })).resolves.toBeUndefined();
      expect(harness.calendarSpies.disconnect).toHaveBeenCalledWith({ userId });
    }
  },
  {
    name: "Gmail authorization",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.gmailOAuth.createAuthorization({ userId, returnTo })
      ).resolves.toBe(authorization);
      expect(harness.gmailSpies.createAuthorization).toHaveBeenCalledWith({
        userId,
        returnTo
      });
    }
  },
  {
    name: "Gmail callback",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.gmailOAuth.handleCallback({ userId, state, code })
      ).resolves.toBe(connection);
      expect(harness.gmailSpies.handleCallback).toHaveBeenCalledWith({
        userId,
        state,
        code
      });
    }
  },
  {
    name: "Gmail denied callback",
    invoke: async (harness: ReturnType<typeof createHarness>) => {
      await expect(
        harness.runtime.gmailOAuth.handleDeniedCallback({ userId, state })
      ).resolves.toBeUndefined();
      expect(harness.gmailSpies.handleDeniedCallback).toHaveBeenCalledWith({
        userId,
        state
      });
    }
  }
] as const;

describe("lazy Google integration runtime", () => {
  it.each(operations)("delegates $name only after first use", async ({ invoke }) => {
    const harness = createHarness();

    expect(harness.runtime.calendar.configurationState).toBe("configured");
    expect(harness.runtime.calendar.oauth).not.toBeNull();
    expect(harness.loader).not.toHaveBeenCalled();

    await invoke(harness);

    expect(harness.loader).toHaveBeenCalledTimes(1);
  });

  it("reuses one successful binding for sequential operations", async () => {
    const harness = createHarness();

    await harness.runtime.calendar.createClient(userId, freeBusyScope);
    await harness.runtime.gmailOAuth.createAuthorization({ userId, returnTo });

    expect(harness.loader).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight load across concurrent first operations", async () => {
    const harness = createHarness();
    let resolveBindings!: (bindings: GoogleIntegrationBindings) => void;
    harness.loader.mockImplementation(
      () =>
        new Promise<GoogleIntegrationBindings>((resolve) => {
          resolveBindings = resolve;
        })
    );

    const calendarOperation = harness.runtime.calendar.createClient(userId, freeBusyScope);
    const gmailOperation = harness.runtime.gmailOAuth.createAuthorization({ userId, returnTo });
    await vi.waitFor(() => expect(harness.loader).toHaveBeenCalledTimes(1));
    resolveBindings(harness.bindings);

    await expect(Promise.all([calendarOperation, gmailOperation])).resolves.toEqual([
      client,
      authorization
    ]);
    expect(harness.loader).toHaveBeenCalledTimes(1);
  });

  it("sanitizes a load failure and retries on the next operation", async () => {
    const harness = createHarness();
    harness.loader
      .mockRejectedValueOnce(new Error("synthetic loader internals must not escape"))
      .mockResolvedValueOnce(harness.bindings);

    const firstError = await harness.runtime.calendar
      .createClient(userId, freeBusyScope)
      .catch((error: unknown) => error);

    expect(firstError).toEqual(new GoogleIntegrationOAuthError("provider_unavailable", 503));
    expect(String(firstError)).not.toContain("loader internals");
    await expect(
      harness.runtime.gmailOAuth.createAuthorization({ userId, returnTo })
    ).resolves.toBe(authorization);
    expect(harness.loader).toHaveBeenCalledTimes(2);
  });

  it("preserves provider-operation failures after a successful load", async () => {
    const harness = createHarness();
    const providerError = new GoogleIntegrationOAuthError("provider_denied", 403);
    harness.calendarSpies.disconnect.mockRejectedValueOnce(providerError);

    await expect(harness.runtime.calendar.oauth!.disconnect({ userId })).rejects.toBe(
      providerError
    );
    expect(harness.loader).toHaveBeenCalledTimes(1);
  });
});
