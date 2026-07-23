import {
  AvailabilityCheckSchema,
  AvailabilityRuleSetSchema,
  CalendarHoldSchema,
  CalendarHoldStateSchema,
  EntityIdSchema,
  IntegrationConnectionSchema,
  IntegrationIdSchema,
  IntegrationProviderSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  type AvailabilityCheck,
  type AvailabilityRuleSet,
  type CalendarHold,
  type CalendarHoldState,
  type IntegrationConnection
} from "@vera/domain";

import {
  RepositoryNotFoundError,
  type AsyncRepository,
  type AvailabilityCheckRepository,
  type AvailabilityRuleSetRepository,
  type CalendarHoldRepository,
  type IntegrationConnectionRepository,
  type UserRepositories
} from "../repositories.ts";

export const DEMO_AVAILABILITY_RULES: AvailabilityRuleSet = AvailabilityRuleSetSchema.parse({
  id: "demo-availability-rules-1",
  timeZone: "America/New_York",
  weeklyIntervals: {
    "1": [{ startsAt: "17:30", endsAt: "20:30" }],
    "2": [{ startsAt: "17:30", endsAt: "20:30" }],
    "3": [{ startsAt: "17:30", endsAt: "20:30" }],
    "4": [{ startsAt: "17:30", endsAt: "20:30" }],
    "5": [{ startsAt: "17:30", endsAt: "20:30" }],
    "6": [{ startsAt: "10:00", endsAt: "16:00" }],
    "7": []
  },
  durationMinutes: 60,
  minimumNoticeMinutes: 120,
  travelMinutes: 20,
  bufferMinutes: 10,
  remindersMinutesBeforeStart: [30],
  conflictCheckingEnabled: false,
  calendarIds: [],
  schemaVersion: 1,
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z"
});

/**
 * This no-credential record lets the deterministic mock exercise scope-aware paths. It is not an
 * OAuth connection and can never be mutated into one through the demo repository.
 */
export const DEMO_GOOGLE_INTEGRATION: IntegrationConnection = IntegrationConnectionSchema.parse({
  id: "018f9f64-7b5a-7c91-a12e-000000000002",
  userId: "018f9f64-7b5a-7c91-a12e-000000000001",
  provider: "google",
  providerSubjectId: "demo-google-calendar-fixture",
  displayEmail: null,
  encryptedRefreshToken: null,
  grantedScopes: ["https://www.googleapis.com/auth/calendar.events.owned"],
  tokenExpiresAt: null,
  status: "partial",
  lastSuccessfulUseAt: null,
  createdAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z"
});

const ALLOWED_HOLD_TRANSITIONS = {
  approval_pending: ["approved", "cancelled_internal"],
  approved: ["creating", "cancelled_internal"],
  creating: ["created", "retryable_failed", "permanently_failed", "cancelled_internal"],
  created: ["cancelled_internal"],
  retryable_failed: ["creating", "permanently_failed", "cancelled_internal"],
  permanently_failed: [],
  cancelled_internal: []
} as const satisfies Record<CalendarHoldState, readonly CalendarHoldState[]>;

export class DemoCalendarConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoCalendarConflictError";
  }
}

export interface DemoCalendarSidecarSnapshot {
  readonly currentRules: AvailabilityRuleSet;
  readonly checks: readonly AvailabilityCheck[];
  readonly holds: readonly CalendarHold[];
}

export interface DemoCalendarSidecar {
  readonly repositories: Pick<
    UserRepositories,
    "integrationConnections" | "availabilityRuleSets" | "availabilityChecks" | "calendarHolds"
  >;
  snapshot(): DemoCalendarSidecarSnapshot;
  restore(snapshot: DemoCalendarSidecarSnapshot): void;
  reset(): void;
}

function cloneRules(value: AvailabilityRuleSet): AvailabilityRuleSet {
  return AvailabilityRuleSetSchema.parse(value);
}

function cloneCheck(value: AvailabilityCheck): AvailabilityCheck {
  return AvailabilityCheckSchema.parse(value);
}

function cloneHold(value: CalendarHold): CalendarHold {
  return CalendarHoldSchema.parse(value);
}

function assertHoldTransition(current: CalendarHoldState, requested: CalendarHoldState): void {
  const allowed: readonly CalendarHoldState[] = ALLOWED_HOLD_TRANSITIONS[current];
  if (!allowed.includes(requested)) {
    throw new DemoCalendarConflictError(
      `Calendar hold cannot transition from ${current} to ${requested}.`
    );
  }
}

function sameImmutableHold(left: CalendarHold, right: CalendarHold): boolean {
  return (
    left.id === right.id &&
    left.viewingId === right.viewingId &&
    left.approvalId === right.approvalId &&
    left.availabilityCheckId === right.availabilityCheckId &&
    left.payloadHash === right.payloadHash &&
    left.idempotencyKey === right.idempotencyKey &&
    left.googleEventId === right.googleEventId &&
    left.conflictCheckOverride === right.conflictCheckOverride &&
    left.conflictCheckOverrideReason === right.conflictCheckOverrideReason
  );
}

function unavailableIntegrationWrites(): never {
  throw new Error("Hosted integration credentials are unavailable in offline demo mode.");
}

export function createDemoCalendarSidecar(): DemoCalendarSidecar {
  let currentRules = cloneRules(DEMO_AVAILABILITY_RULES);
  const checks = new Map<string, AvailabilityCheck>();
  const holds = new Map<string, CalendarHold>();
  const holdIdsByIdempotencyKey = new Map<string, string>();

  const integrationConnections: AsyncRepository<IntegrationConnectionRepository> = {
    async upsert() {
      return unavailableIntegrationWrites();
    },
    async getById(input) {
      return IntegrationIdSchema.parse(input) === DEMO_GOOGLE_INTEGRATION.id
        ? IntegrationConnectionSchema.parse(DEMO_GOOGLE_INTEGRATION)
        : null;
    },
    async getByProviderSubjectId(providerInput, providerSubjectId) {
      const provider = IntegrationProviderSchema.parse(providerInput);
      return provider === DEMO_GOOGLE_INTEGRATION.provider &&
        providerSubjectId === DEMO_GOOGLE_INTEGRATION.providerSubjectId
        ? IntegrationConnectionSchema.parse(DEMO_GOOGLE_INTEGRATION)
        : null;
    },
    async list() {
      return [IntegrationConnectionSchema.parse(DEMO_GOOGLE_INTEGRATION)];
    },
    async delete() {
      return false;
    }
  };

  const availabilityRuleSets: AsyncRepository<AvailabilityRuleSetRepository> = {
    async upsertCurrent(input) {
      const value = AvailabilityRuleSetSchema.parse(input);
      if (value.id !== currentRules.id) {
        throw new DemoCalendarConflictError(
          "The current demo availability rule set has a different stable identifier."
        );
      }
      if (Date.parse(value.updatedAt) < Date.parse(currentRules.updatedAt)) {
        throw new DemoCalendarConflictError(
          "Demo availability rules cannot move backward in time."
        );
      }
      currentRules = AvailabilityRuleSetSchema.parse({
        ...value,
        createdAt: currentRules.createdAt
      });
      return cloneRules(currentRules);
    },
    async getCurrent() {
      return cloneRules(currentRules);
    }
  };

  const availabilityChecks: AsyncRepository<AvailabilityCheckRepository> = {
    async append(input) {
      const value = AvailabilityCheckSchema.parse(input);
      if (value.availabilityRuleSetId !== currentRules.id) {
        throw new DemoCalendarConflictError(
          "Availability check does not reference the current demo rule set."
        );
      }
      if (
        value.integrationConnectionId !== null &&
        value.integrationConnectionId !== DEMO_GOOGLE_INTEGRATION.id
      ) {
        throw new DemoCalendarConflictError(
          "Availability check does not reference the demo Calendar fixture."
        );
      }
      if (checks.has(value.id)) {
        throw new DemoCalendarConflictError("Availability checks are append-only.");
      }
      checks.set(value.id, cloneCheck(value));
      return cloneCheck(value);
    },
    async getById(input) {
      const value = checks.get(EntityIdSchema.parse(input));
      return value ? cloneCheck(value) : null;
    },
    async listRecent(limitInput) {
      const limit = Math.trunc(limitInput);
      if (limit < 1 || limit > 500) {
        throw new RangeError("Availability check limit must be 1–500.");
      }
      return [...checks.values()]
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
        )
        .slice(0, limit)
        .map(cloneCheck);
    }
  };

  const calendarHolds: AsyncRepository<CalendarHoldRepository> = {
    async insert(input) {
      const value = CalendarHoldSchema.parse(input);
      if (value.availabilityCheckId !== null && !checks.has(value.availabilityCheckId)) {
        throw new DemoCalendarConflictError(
          "Calendar hold does not reference a persisted availability check."
        );
      }
      const existingId = holdIdsByIdempotencyKey.get(value.idempotencyKey);
      const existing = existingId ? holds.get(existingId) : undefined;
      if (existing !== undefined) {
        if (!sameImmutableHold(existing, value)) {
          throw new DemoCalendarConflictError(
            "The Calendar hold idempotency key belongs to a different immutable payload."
          );
        }
        return cloneHold(existing);
      }
      if (holds.has(value.id)) {
        throw new DemoCalendarConflictError(
          "The Calendar hold identifier belongs to a different operation."
        );
      }
      holds.set(value.id, cloneHold(value));
      holdIdsByIdempotencyKey.set(value.idempotencyKey, value.id);
      return cloneHold(value);
    },
    async getById(input) {
      const value = holds.get(EntityIdSchema.parse(input));
      return value ? cloneHold(value) : null;
    },
    async getByIdempotencyKey(input) {
      const key = Sha256Schema.parse(input);
      const id = holdIdsByIdempotencyKey.get(key);
      const value = id ? holds.get(id) : undefined;
      return value ? cloneHold(value) : null;
    },
    async listByViewingId(input) {
      const viewingId = EntityIdSchema.parse(input);
      return [...holds.values()]
        .filter((hold) => hold.viewingId === viewingId)
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
        )
        .map(cloneHold);
    },
    async transition(idInput, expectedInput, requestedInput, atInput, patch = {}) {
      const id = EntityIdSchema.parse(idInput);
      const expected = CalendarHoldStateSchema.parse(expectedInput);
      const requested = CalendarHoldStateSchema.parse(requestedInput);
      const at = IsoDateTimeSchema.parse(atInput);
      assertHoldTransition(expected, requested);
      const current = holds.get(id);
      if (!current) throw new RepositoryNotFoundError("CalendarHold", id);
      if (current.state !== expected) {
        throw new DemoCalendarConflictError("Calendar hold state changed concurrently.");
      }
      if (Date.parse(at) < Date.parse(current.updatedAt)) {
        throw new DemoCalendarConflictError(
          "Calendar hold transition time cannot precede its current update time."
        );
      }
      const terminal = ["created", "permanently_failed", "cancelled_internal"].includes(requested);
      const failed = requested === "retryable_failed" || requested === "permanently_failed";
      const candidate = CalendarHoldSchema.parse({
        ...current,
        state: requested,
        approvalId: patch.approvalId !== undefined ? patch.approvalId : current.approvalId,
        providerEventReference:
          patch.providerEventReference ??
          (requested === "created" || requested === "cancelled_internal"
            ? current.providerEventReference
            : null),
        availabilityCheckId: patch.availabilityCheckId ?? current.availabilityCheckId,
        safeErrorCode: failed ? (patch.safeErrorCode ?? current.safeErrorCode) : null,
        updatedAt: at,
        completedAt: terminal ? (patch.completedAt ?? at) : null
      });
      holds.set(id, cloneHold(candidate));
      return cloneHold(candidate);
    }
  };

  function snapshot(): DemoCalendarSidecarSnapshot {
    return {
      currentRules: cloneRules(currentRules),
      checks: [...checks.values()].map(cloneCheck),
      holds: [...holds.values()].map(cloneHold)
    };
  }

  function restore(input: DemoCalendarSidecarSnapshot): void {
    const restoredRules = AvailabilityRuleSetSchema.parse(input.currentRules);
    const restoredChecks = input.checks.map(cloneCheck);
    const restoredHolds = input.holds.map(cloneHold);
    currentRules = restoredRules;
    checks.clear();
    holds.clear();
    holdIdsByIdempotencyKey.clear();
    for (const check of restoredChecks) checks.set(check.id, check);
    for (const hold of restoredHolds) {
      if (holds.has(hold.id) || holdIdsByIdempotencyKey.has(hold.idempotencyKey)) {
        throw new DemoCalendarConflictError("Demo Calendar snapshot contains duplicate holds.");
      }
      holds.set(hold.id, hold);
      holdIdsByIdempotencyKey.set(hold.idempotencyKey, hold.id);
    }
  }

  return {
    repositories: {
      integrationConnections,
      availabilityRuleSets,
      availabilityChecks,
      calendarHolds
    },
    snapshot,
    restore,
    reset() {
      restore({ currentRules: DEMO_AVAILABILITY_RULES, checks: [], holds: [] });
    }
  };
}
