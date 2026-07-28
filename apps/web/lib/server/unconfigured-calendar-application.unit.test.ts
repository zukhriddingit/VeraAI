import { CalendarProviderError } from "@vera/calendar/errors";
import { describe, expect, it } from "vitest";

import { createUnconfiguredCalendarApplication } from "./unconfigured-calendar-application.ts";

const userId = "018f9f64-7b5a-7c91-a12e-111111111111";
const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy" as const;

describe("unconfigured Calendar application", () => {
  it("fails closed without loading a provider-backed client", async () => {
    const application = createUnconfiguredCalendarApplication();

    expect(application).toMatchObject({ configurationState: "unconfigured", oauth: null });
    await expect(application.createClient(userId, freeBusyScope)).rejects.toEqual(
      new CalendarProviderError("calendar_disconnected", false, 409)
    );
  });
});
