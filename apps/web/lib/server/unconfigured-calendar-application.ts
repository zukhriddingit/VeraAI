import { CalendarProviderError } from "@vera/calendar/errors";

import type { CalendarApplicationDependencies } from "./calendar-application.ts";

export function createUnconfiguredCalendarApplication(): CalendarApplicationDependencies {
  return {
    configurationState: "unconfigured",
    oauth: null,
    async createClient() {
      throw new CalendarProviderError("calendar_disconnected", false, 409);
    }
  };
}
