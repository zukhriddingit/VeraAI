import type { CalendarClient } from "@vera/calendar";

import type { CalendarApplicationDependencies } from "./calendar-application.ts";

export function createDemoCalendarApplication(
  client: CalendarClient
): CalendarApplicationDependencies {
  return {
    configurationState: "demo",
    oauth: null,
    async createClient() {
      return client;
    }
  };
}
