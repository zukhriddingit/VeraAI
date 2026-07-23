import {
  AvailabilityCheckSchema,
  AvailabilityRuleSetSchema,
  IntegrationConnectionSchema,
  type AvailabilityCheck,
  type AvailabilityRuleSet,
  type IntegrationConnection,
  type VeraUserId
} from "@vera/domain";
import {
  CalendarProviderError,
  MockCalendarClient,
  type CalendarProviderErrorCode,
  type FreeBusyResult
} from "@vera/calendar";
import type { UserRepositories } from "@vera/db";

import { createDemoCalendarApplication } from "./server/demo-calendar-application.ts";
import {
  createCalendarAvailabilityService,
  type CalendarAvailabilityService
} from "./calendar-service.ts";

export const FIXED_USER_ID = "018f9f64-7b5a-7c91-a12e-111111111111" as VeraUserId;
export const FIXED_NOW = "2026-07-21T12:00:00.000Z";

const EMPTY_WEEK = {
  "1": [],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "7": []
} as const;

export const proposalInput = {
  userId: FIXED_USER_ID,
  canonicalListingId: "listing-calendar-1",
  now: FIXED_NOW,
  correlationId: "correlation-calendar-1"
} as const;

export const availabilityRules = AvailabilityRuleSetSchema.parse({
  id: "availability-rules-1",
  timeZone: "America/New_York",
  weeklyIntervals: {
    ...EMPTY_WEEK,
    "1": [{ startsAt: "09:00", endsAt: "14:00" }]
  },
  durationMinutes: 60,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 10,
  remindersMinutesBeforeStart: [30],
  conflictCheckingEnabled: true,
  calendarIds: ["primary"],
  schemaVersion: 1,
  createdAt: "2026-07-20T12:00:00.000Z",
  updatedAt: "2026-07-20T12:00:00.000Z"
});

export const googleConnection = IntegrationConnectionSchema.parse({
  id: "018f9f64-7b5a-7c91-a12e-222222222222",
  userId: FIXED_USER_ID,
  provider: "google",
  providerSubjectId: "google-subject-calendar-fixture",
  displayEmail: "renter@example.test",
  encryptedRefreshToken: {
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: "test-key",
    nonce: Buffer.alloc(12, 1).toString("base64"),
    ciphertext: Buffer.from("synthetic-encrypted-token").toString("base64"),
    authenticationTag: Buffer.alloc(16, 2).toString("base64")
  },
  grantedScopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
  tokenExpiresAt: "2026-07-21T13:00:00.000Z",
  status: "connected",
  lastSuccessfulUseAt: "2026-07-21T11:00:00.000Z",
  createdAt: "2026-07-20T12:00:00.000Z",
  updatedAt: "2026-07-21T11:00:00.000Z"
});

export const busyResult: FreeBusyResult = {
  busyIntervals: [
    {
      startsAt: "2026-07-27T14:00:00.000Z",
      endsAt: "2026-07-27T15:00:00.000Z"
    }
  ],
  calendarsChecked: ["primary"],
  checkedAt: FIXED_NOW
};

export function calendarFailure(code: CalendarProviderErrorCode): CalendarProviderError {
  const retryable = [
    "calendar_timeout",
    "calendar_rate_limited",
    "calendar_transient_failure"
  ].includes(code);
  return new CalendarProviderError(code, retryable, code === "calendar_timeout" ? 504 : 503);
}

interface ServiceFixtureOptions {
  readonly connection?: IntegrationConnection | null;
  readonly rules?: AvailabilityRuleSet;
}

export function serviceWith(
  script: FreeBusyResult | CalendarProviderError,
  options: ServiceFixtureOptions = {}
): {
  readonly service: CalendarAvailabilityService;
  readonly persistedChecks: readonly AvailabilityCheck[];
  readonly client: MockCalendarClient;
  readonly repositories: UserRepositories;
} {
  const checks: AvailabilityCheck[] = [];
  const connection = options.connection === undefined ? googleConnection : options.connection;
  let currentRules = options.rules ?? availabilityRules;
  const client = new MockCalendarClient({ freeBusy: [script] });
  const repositories = {
    availabilityRuleSets: {
      async upsertCurrent(value: AvailabilityRuleSet) {
        currentRules = AvailabilityRuleSetSchema.parse(value);
        return currentRules;
      },
      async getCurrent() {
        return currentRules;
      }
    },
    integrationConnections: {
      async list() {
        return connection === null ? [] : [connection];
      }
    },
    availabilityChecks: {
      async append(value: AvailabilityCheck) {
        const parsed = AvailabilityCheckSchema.parse(value);
        checks.push(parsed);
        return parsed;
      },
      async getById(id: string) {
        return checks.find((check) => check.id === id) ?? null;
      },
      async listRecent(limit: number) {
        return checks.slice(-limit).reverse();
      }
    }
  } as unknown as UserRepositories;

  return {
    service: createCalendarAvailabilityService({
      userId: FIXED_USER_ID,
      repositories,
      calendar: createDemoCalendarApplication(client),
      idFactory: () => `availability-check-${checks.length + 1}`
    }),
    persistedChecks: checks,
    client,
    repositories
  };
}
