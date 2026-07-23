import { CalendarProviderError, MockCalendarClient } from "@vera/calendar";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedCalendarApplication,
  createUnconfiguredCalendarApplication
} from "./calendar-application.ts";
import { createDemoCalendarApplication } from "./demo-calendar-application.ts";

const userId = "018f9f64-7b5a-7c91-a12e-111111111111";
const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy" as const;

describe("Calendar application composition", () => {
  it("fails closed when hosted integration OAuth is unconfigured", async () => {
    await expect(
      createUnconfiguredCalendarApplication().createClient(userId, freeBusyScope)
    ).rejects.toEqual(new CalendarProviderError("calendar_disconnected", false, 409));
  });

  it("resolves a scoped access token before constructing a hosted client", async () => {
    const client = new MockCalendarClient();
    const refreshAccessToken = vi.fn(async () => "synthetic-access-token");
    const clientFactory = vi.fn(() => client);
    const application = createHostedCalendarApplication({
      configuration: {
        clientId: "client-id",
        clientSecret: "synthetic-secret",
        redirectUri: "https://vera.example.test/api/integrations/google/calendar/callback",
        gmailRedirectUri: "https://vera.example.test/api/integrations/google/gmail/callback",
        publicBaseUrl: "https://vera.example.test",
        oauthStateTtlMilliseconds: 600_000,
        providerTimeoutMilliseconds: 5_000,
        credentialKeyProvider: {} as never
      },
      oauth: { refreshAccessToken } as never,
      clientFactory
    });

    await expect(application.createClient(userId, freeBusyScope)).resolves.toBe(client);
    expect(refreshAccessToken).toHaveBeenCalledWith({
      userId,
      requiredScope: freeBusyScope,
      signal: undefined
    });
    expect(clientFactory).toHaveBeenCalledWith("synthetic-access-token");
  });

  it("returns one process-owned no-network mock in demo mode", async () => {
    const client = new MockCalendarClient();
    const application = createDemoCalendarApplication(client);
    await expect(application.createClient(userId, freeBusyScope)).resolves.toBe(client);
    await expect(application.createClient(userId, freeBusyScope)).resolves.toBe(client);
    expect(application).toMatchObject({ configurationState: "demo", oauth: null });
  });
});
