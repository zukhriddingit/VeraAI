import {
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  type VeraDatabaseConnection
} from "@vera/db/demo";
import { ReadinessReportSchema } from "@vera/domain";
import { MockCalendarClient } from "@vera/calendar/mock";

import type { VeraApplication } from "./application-registry.ts";
import { createDemoCalendarApplication } from "./demo-calendar-application.ts";

export function createDemoApplication(connection: VeraDatabaseConnection): VeraApplication {
  return {
    mode: "demo",
    repositoryProvider: createDemoRepositoryProvider(connection),
    auth: null,
    calendar: createDemoCalendarApplication(
      new MockCalendarClient({ deterministicHoldOperations: true })
    ),
    gmailOAuth: null,
    demoUserId: DEMO_USER_ID,
    readiness: async () =>
      ReadinessReportSchema.parse({
        service: "vera-web",
        status: "ready",
        checkedAt: new Date().toISOString(),
        database: { status: "ready", migration: "current" }
      }),
    close: async () => connection.close()
  };
}
