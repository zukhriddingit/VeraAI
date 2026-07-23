import { randomUUID } from "node:crypto";

import {
  CalendarProviderError,
  FreeBusyResultSchema,
  generateViewingWindows,
  isAvailabilityCheckFresh,
  markStaleWindowAtRead,
  type FreeBusyResult
} from "@vera/calendar";
import {
  AvailabilityCheckSchema,
  CalendarIntegrationStatusResponseSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  VeraUserIdSchema,
  type AvailabilityCheck,
  type AvailabilityCheckState,
  type CalendarCapabilityGrantState,
  type CalendarIntegrationStatusResponse,
  type IntegrationConnection,
  type ProposedViewingWindow,
  type VeraUserId
} from "@vera/domain";
import { sha256Text, type UserRepositories } from "@vera/db";

import type { CalendarApplicationDependencies } from "./server/calendar-application.ts";
import { GoogleIntegrationOAuthError } from "./server/google-integration-oauth.ts";

const FREE_BUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy" as const;
const HOLD_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned" as const;
const PLANNING_HORIZON_MILLISECONDS = 14 * 24 * 60 * 60 * 1_000;

export interface CreateViewingProposalsInput {
  readonly userId: VeraUserId;
  readonly canonicalListingId: string;
  readonly now: string;
  readonly correlationId: string;
}

export interface ViewingProposalResult {
  readonly state: AvailabilityCheckState;
  readonly calendarsChecked: readonly [] | readonly ["primary"];
  readonly checkedAt: string | null;
  readonly availabilityCheck: AvailabilityCheck;
  readonly windows: readonly ProposedViewingWindow[];
}

export interface CalendarAvailabilityService {
  propose(input: CreateViewingProposalsInput): Promise<ViewingProposalResult>;
}

export class AvailabilityRulesNotConfiguredError extends Error {
  constructor() {
    super("Viewing availability rules have not been configured.");
    this.name = "AvailabilityRulesNotConfiguredError";
  }
}

interface CalendarAvailabilityServiceDependencies {
  readonly userId: VeraUserId;
  readonly repositories: Pick<
    UserRepositories,
    "availabilityRuleSets" | "integrationConnections" | "availabilityChecks"
  >;
  readonly calendar: CalendarApplicationDependencies;
  readonly idFactory?: () => string;
}

interface DegradedResult {
  readonly state: Exclude<AvailabilityCheckState, "checked" | "stale">;
  readonly safeProviderErrorCode: string | null;
  readonly attemptedPrimary: boolean;
}

async function onlyGoogleConnection(
  repositories: Pick<UserRepositories, "integrationConnections">
): Promise<IntegrationConnection | null> {
  const connections = (await repositories.integrationConnections.list()).filter(
    (connection) => connection.provider === "google"
  );
  if (connections.length > 1) {
    throw new Error("Multiple Google integration connections require account-linking recovery.");
  }
  return connections[0] ?? null;
}

function capabilityGrantState(
  connection: IntegrationConnection,
  requiredScope: typeof FREE_BUSY_SCOPE | typeof HOLD_SCOPE
): CalendarCapabilityGrantState {
  switch (connection.status) {
    case "expired":
      return "expired";
    case "revoked":
    case "reconnect_required":
      return "revoked";
    case "disconnected":
      return "disconnected";
    case "connected":
    case "partial":
      return connection.grantedScopes.includes(requiredScope) ? "granted" : "missing";
  }
}

export async function getCalendarIntegrationStatus(
  repositories: Pick<UserRepositories, "integrationConnections">,
  configurationState: CalendarApplicationDependencies["configurationState"],
  now: string
): Promise<CalendarIntegrationStatusResponse> {
  const generatedAt = IsoDateTimeSchema.parse(now);
  const connection = await onlyGoogleConnection(repositories);
  const baseState: CalendarCapabilityGrantState | null =
    configurationState === "unconfigured"
      ? "unconfigured"
      : configurationState === "demo"
        ? "disconnected"
        : connection === null
          ? "disconnected"
          : null;
  const exposeConnectedAccount =
    configurationState !== "demo" && connection !== null && connection.status !== "disconnected";
  const accountEmail = exposeConnectedAccount ? connection.displayEmail : null;
  const lastSuccessfulUseAt = exposeConnectedAccount ? connection.lastSuccessfulUseAt : null;

  return CalendarIntegrationStatusResponseSchema.parse({
    conflictChecking: {
      capability: "calendar_conflict_checking",
      state: baseState ?? capabilityGrantState(connection!, FREE_BUSY_SCOPE),
      accountEmail,
      lastSuccessfulUseAt
    },
    holdCreation: {
      capability: "calendar_hold_creation",
      state: baseState ?? capabilityGrantState(connection!, HOLD_SCOPE),
      accountEmail,
      lastSuccessfulUseAt
    },
    primaryCalendarOnly: true,
    generatedAt
  });
}

function disconnectedConnection(connection: IntegrationConnection): boolean {
  return ["expired", "revoked", "disconnected", "reconnect_required"].includes(connection.status);
}

function degradedProviderResult(error: unknown): DegradedResult {
  if (error instanceof CalendarProviderError) {
    if (error.code === "calendar_scope_not_granted") {
      return { state: "scope_not_granted", safeProviderErrorCode: null, attemptedPrimary: false };
    }
    if (
      ["calendar_disconnected", "calendar_auth_revoked", "calendar_permission_denied"].includes(
        error.code
      )
    ) {
      return { state: "google_disconnected", safeProviderErrorCode: null, attemptedPrimary: false };
    }
    return {
      state: "google_temporarily_unavailable",
      safeProviderErrorCode: error.code,
      attemptedPrimary: true
    };
  }

  if (error instanceof GoogleIntegrationOAuthError) {
    if (error.code === "scope_not_granted") {
      return { state: "scope_not_granted", safeProviderErrorCode: null, attemptedPrimary: false };
    }
    if (["google_disconnected", "reconnect_required"].includes(error.code)) {
      return { state: "google_disconnected", safeProviderErrorCode: null, attemptedPrimary: false };
    }
  }

  return {
    state: "google_temporarily_unavailable",
    safeProviderErrorCode: "calendar_transient_failure",
    attemptedPrimary: true
  };
}

function rangeEndsAt(now: string): string {
  return new Date(Date.parse(now) + PLANNING_HORIZON_MILLISECONDS).toISOString();
}

function freeBusyResponseHash(result: FreeBusyResult): string {
  return sha256Text(
    JSON.stringify({
      calendarsChecked: result.calendarsChecked,
      checkedAt: result.checkedAt,
      busyIntervals: result.busyIntervals
    })
  );
}

function assertBusyIntervalsWithinRange(
  result: FreeBusyResult,
  startsAt: string,
  endsAt: string
): void {
  const rangeStart = Date.parse(startsAt);
  const rangeEnd = Date.parse(endsAt);
  if (
    result.busyIntervals.some(
      (interval) =>
        Date.parse(interval.startsAt) < rangeStart || Date.parse(interval.endsAt) > rangeEnd
    )
  ) {
    throw new CalendarProviderError("calendar_validation_failed", false, 502);
  }
}

function proposalResult(
  state: AvailabilityCheckState,
  check: AvailabilityCheck,
  windows: readonly ProposedViewingWindow[]
): ViewingProposalResult {
  return {
    state,
    calendarsChecked: check.calendarsChecked,
    checkedAt: check.checkedAt,
    availabilityCheck: check,
    windows
  };
}

export function markViewingProposalStaleAtRead(
  input: ViewingProposalResult,
  nowInput: string
): ViewingProposalResult {
  const now = IsoDateTimeSchema.parse(nowInput);
  if (input.state !== "checked" || input.checkedAt === null) return input;
  if (Date.parse(input.checkedAt) > Date.parse(now)) {
    throw new RangeError("An availability check timestamp cannot be in the future.");
  }
  if (isAvailabilityCheckFresh(input.checkedAt, now)) return input;

  return {
    ...input,
    state: "stale",
    windows: input.windows.map((window) => markStaleWindowAtRead({ window, now }))
  };
}

export function createCalendarAvailabilityService(
  dependencies: CalendarAvailabilityServiceDependencies
): CalendarAvailabilityService {
  const ownerId = VeraUserIdSchema.parse(dependencies.userId);
  const idFactory = dependencies.idFactory ?? randomUUID;

  async function appendDegradedCheck(input: {
    readonly availabilityRuleSetId: string;
    readonly integrationConnectionId: string | null;
    readonly state: DegradedResult["state"];
    readonly safeProviderErrorCode: string | null;
    readonly attemptedPrimary: boolean;
    readonly rangeStartsAt: string;
    readonly rangeEndsAt: string;
    readonly correlationId: string;
  }): Promise<AvailabilityCheck> {
    return dependencies.repositories.availabilityChecks.append(
      AvailabilityCheckSchema.parse({
        id: EntityIdSchema.parse(idFactory()),
        availabilityRuleSetId: input.availabilityRuleSetId,
        integrationConnectionId: input.integrationConnectionId,
        state: input.state,
        rangeStartsAt: input.rangeStartsAt,
        rangeEndsAt: input.rangeEndsAt,
        calendarIdsAttempted: input.attemptedPrimary ? ["primary"] : [],
        calendarsChecked: [],
        checkedAt: null,
        responseHash: null,
        busyIntervalCount: null,
        safeProviderErrorCode: input.safeProviderErrorCode,
        correlationId: input.correlationId,
        createdAt: input.rangeStartsAt
      })
    );
  }

  return {
    async propose(untrustedInput) {
      const input: CreateViewingProposalsInput = {
        userId: VeraUserIdSchema.parse(untrustedInput.userId),
        canonicalListingId: EntityIdSchema.parse(untrustedInput.canonicalListingId),
        now: IsoDateTimeSchema.parse(untrustedInput.now),
        correlationId: EntityIdSchema.parse(untrustedInput.correlationId)
      };
      if (input.userId !== ownerId) {
        throw new Error("Availability service ownership does not match the request user.");
      }

      const rules = await dependencies.repositories.availabilityRuleSets.getCurrent();
      if (rules === null) throw new AvailabilityRulesNotConfiguredError();
      const end = rangeEndsAt(input.now);

      if (!rules.conflictCheckingEnabled) {
        const check = await appendDegradedCheck({
          availabilityRuleSetId: rules.id,
          integrationConnectionId: null,
          state: "vera_rules_only",
          safeProviderErrorCode: null,
          attemptedPrimary: false,
          rangeStartsAt: input.now,
          rangeEndsAt: end,
          correlationId: input.correlationId
        });
        const windows = generateViewingWindows({
          now: input.now,
          rules,
          horizonDays: 14,
          availability: {
            state: "vera_rules_only",
            checkId: check.id,
            checkedAt: null,
            calendarIds: []
          }
        });
        return proposalResult("vera_rules_only", check, windows);
      }

      const connection = await onlyGoogleConnection(dependencies.repositories);
      const unavailableState: DegradedResult["state"] | null =
        dependencies.calendar.configurationState === "unconfigured" ||
        connection === null ||
        disconnectedConnection(connection)
          ? "google_disconnected"
          : !connection.grantedScopes.includes(FREE_BUSY_SCOPE)
            ? "scope_not_granted"
            : null;

      if (unavailableState !== null) {
        const check = await appendDegradedCheck({
          availabilityRuleSetId: rules.id,
          integrationConnectionId: connection?.id ?? null,
          state: unavailableState,
          safeProviderErrorCode: null,
          attemptedPrimary: false,
          rangeStartsAt: input.now,
          rangeEndsAt: end,
          correlationId: input.correlationId
        });
        const windows = generateViewingWindows({
          now: input.now,
          rules,
          horizonDays: 14,
          availability: {
            state: unavailableState,
            checkId: check.id,
            checkedAt: null,
            calendarIds: []
          }
        });
        return proposalResult(unavailableState, check, windows);
      }
      if (connection === null) {
        throw new Error("Available Calendar checking requires a Google integration connection.");
      }

      let result: FreeBusyResult;
      try {
        const client = await dependencies.calendar.createClient(ownerId, FREE_BUSY_SCOPE);
        result = FreeBusyResultSchema.parse(
          await client.queryFreeBusy({
            startsAt: input.now,
            endsAt: end,
            timeZone: rules.timeZone,
            calendarIds: ["primary"]
          })
        );
        assertBusyIntervalsWithinRange(result, input.now, end);
      } catch (error: unknown) {
        const degraded = degradedProviderResult(error);
        const check = await appendDegradedCheck({
          availabilityRuleSetId: rules.id,
          integrationConnectionId: connection.id,
          ...degraded,
          rangeStartsAt: input.now,
          rangeEndsAt: end,
          correlationId: input.correlationId
        });
        const windows = generateViewingWindows({
          now: input.now,
          rules,
          horizonDays: 14,
          availability: {
            state: degraded.state,
            checkId: check.id,
            checkedAt: null,
            calendarIds: []
          }
        });
        return proposalResult(degraded.state, check, windows);
      }

      const check = await dependencies.repositories.availabilityChecks.append(
        AvailabilityCheckSchema.parse({
          id: EntityIdSchema.parse(idFactory()),
          availabilityRuleSetId: rules.id,
          integrationConnectionId: connection.id,
          state: "checked",
          rangeStartsAt: input.now,
          rangeEndsAt: end,
          calendarIdsAttempted: ["primary"],
          calendarsChecked: ["primary"],
          checkedAt: result.checkedAt,
          responseHash: freeBusyResponseHash(result),
          busyIntervalCount: result.busyIntervals.length,
          safeProviderErrorCode: null,
          correlationId: input.correlationId,
          createdAt: result.checkedAt
        })
      );
      const windows = generateViewingWindows({
        now: result.checkedAt,
        rules,
        horizonDays: 14,
        availability: {
          state: "checked",
          checkId: check.id,
          checkedAt: result.checkedAt,
          calendarIds: ["primary"],
          busy: result.busyIntervals
        }
      });
      return proposalResult("checked", check, windows);
    }
  };
}
