import { randomUUID } from "node:crypto";

import {
  buildCalendarHoldEffectPayload,
  buildInsertTentativeHoldRequest,
  CalendarProviderError,
  computeCalendarPayloadHash,
  computeGoogleEventId,
  generateViewingWindows,
  type CalendarClient,
  type CalendarHoldLookup,
  type FreeBusyResult
} from "@vera/calendar";
import {
  ActivityEventSchema,
  ApprovalSchema,
  AvailabilityCheckSchema,
  CalendarHoldApprovalPreviewSchema,
  CalendarHoldPreviewResponseSchema,
  CalendarHoldSchema,
  CreateApprovedCalendarHoldResponseSchema,
  CreateConflictCheckOverrideResponseSchema,
  CreateViewingProposalsResponseSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  ReminderMinutesSchema,
  RescheduleViewingResponseSchema,
  SelectViewingWindowResponseSchema,
  VeraUserIdSchema,
  ViewingSchema,
  type ActivityEvent,
  type Approval,
  type AvailabilityCheck,
  type AvailabilityCheckState,
  type CalendarHold,
  type CalendarHoldApprovalPreview,
  type CreateApprovedCalendarHoldResponse,
  type CreateConflictCheckOverrideResponse,
  type CreateViewingProposalsResponse,
  type ErrorCategory,
  type ProposedViewingWindow,
  type RescheduleViewingResponse,
  type SelectViewingWindowResponse,
  type VeraUserId,
  type Viewing
} from "@vera/domain";
import {
  approveCalendarHold,
  beginCalendarHoldCreation,
  cancelViewingInternally,
  canonicalJson,
  failCalendarHoldCreation,
  finalizeCalendarHoldCreation,
  RepositoryNotFoundError,
  sha256Text,
  startViewingReschedule,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import type { SourcePolicyRegistry } from "@vera/policy";

import {
  createCalendarAvailabilityService,
  type CalendarAvailabilityService
} from "./calendar-service.ts";
import { createPersistedPolicyRegistry } from "./connector-registry.ts";
import type { CalendarApplicationDependencies } from "./server/calendar-application.ts";

const FREE_BUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy" as const;
const HOLD_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned" as const;
const APPROVAL_TTL_MILLISECONDS = 10 * 60 * 1_000;
const REPLACEMENT_HORIZON_MILLISECONDS = 14 * 24 * 60 * 60 * 1_000;
const GOOGLE_CALENDAR_CONNECTOR_ID = "google.calendar.v1";
const HOLD_PREPARATION_REMINDERS_KEY = "calendarHoldRemindersMinutesBeforeStart";
const EXTERNAL_CLEANUP_WARNING =
  "The Google Calendar hold may still exist; remove it manually if it is no longer needed.";

export type CalendarHoldServiceErrorCode =
  | "not_found"
  | "invalid_state_transition"
  | "approval_required"
  | "approval_expired"
  | "approval_payload_mismatch"
  | "calendar_scope_not_granted"
  | "calendar_disconnected"
  | "calendar_temporarily_unavailable"
  | "viewing_conflict_detected"
  | "policy_denied"
  | "calendar_creation_failed"
  | "validation_failed";

export class CalendarHoldServiceError extends Error {
  constructor(
    readonly code: CalendarHoldServiceErrorCode,
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "CalendarHoldServiceError";
  }
}

export interface ProposeViewingInput {
  readonly canonicalListingId: string;
  readonly correlationId: string;
}

export interface SelectViewingWindowInput {
  readonly viewingId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly correlationId: string;
}

export interface CreateCalendarHoldPreviewInput {
  readonly viewingId: string;
  readonly contactNotes: string | null;
  readonly remindersMinutesBeforeStart: readonly number[];
}

export interface ApproveCalendarHoldPreviewInput {
  readonly viewingId: string;
  readonly holdId: string;
  readonly expectedPayloadHash: string;
  readonly correlationId: string;
}

export interface CreateApprovedHoldInput {
  readonly viewingId: string;
  readonly approvalId: string;
  readonly expectedPayloadHash: string;
  readonly conflictCheckOverride: boolean;
  readonly correlationId: string;
}

export interface CreateOverridePreviewInput {
  readonly viewingId: string;
  readonly holdId: string;
  readonly expectedPayloadHash: string;
}

export interface InternalViewingMutationInput {
  readonly viewingId: string;
  readonly correlationId: string;
}

export interface CalendarHoldService {
  proposeViewing(input: ProposeViewingInput): Promise<CreateViewingProposalsResponse>;
  selectWindow(input: SelectViewingWindowInput): Promise<SelectViewingWindowResponse>;
  createPreview(input: CreateCalendarHoldPreviewInput): Promise<{
    readonly hold: CalendarHold;
    readonly preview: CalendarHoldApprovalPreview;
  }>;
  approvePreview(input: ApproveCalendarHoldPreviewInput): Promise<{
    readonly approval: Approval;
    readonly hold: CalendarHold;
  }>;
  createApprovedHold(input: CreateApprovedHoldInput): Promise<CreateApprovedCalendarHoldResponse>;
  createOverridePreview(
    input: CreateOverridePreviewInput
  ): Promise<CreateConflictCheckOverrideResponse>;
  reschedule(input: InternalViewingMutationInput): Promise<RescheduleViewingResponse>;
  cancel(input: InternalViewingMutationInput): Promise<{
    readonly viewing: Viewing;
    readonly externalCleanupRequired: boolean;
    readonly warning: string | null;
  }>;
}

interface CalendarHoldServiceDependencies {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly calendar: CalendarApplicationDependencies;
  readonly availabilityService?: CalendarAvailabilityService;
  readonly clock?: () => string;
  readonly idFactory?: () => string;
  readonly policyRegistryFactory?: () => Promise<SourcePolicyRegistry>;
}

interface EffectContext {
  readonly viewing: Viewing;
  readonly shortAddress: string;
  readonly normalizedAddress: string;
  readonly canonicalListingUrl: string | null;
  readonly sourceUrls: readonly string[];
  readonly contactNotes: string | null;
  readonly remindersMinutesBeforeStart: readonly number[];
}

interface FinalCheckResult {
  readonly check: AvailabilityCheck;
  readonly busyIntervals: FreeBusyResult["busyIntervals"];
}

function exactWindow(
  left: Pick<ProposedViewingWindow, "startsAt" | "endsAt">,
  right: Pick<ProposedViewingWindow, "startsAt" | "endsAt">
): boolean {
  return left.startsAt === right.startsAt && left.endsAt === right.endsAt;
}

function uniqueSorted(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))].sort();
}

function addressParts(address: {
  readonly line1: string | null;
  readonly unit: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
}): { readonly short: string; readonly full: string } {
  if (
    address.line1 === null ||
    address.city === null ||
    address.region === null ||
    address.postalCode === null
  ) {
    throw new CalendarHoldServiceError(
      "validation_failed",
      "A complete normalized address is required before creating a Calendar hold.",
      409
    );
  }
  const line = [address.line1, address.unit === null ? null : `Unit ${address.unit}`]
    .filter((part): part is string => part !== null)
    .join(" ");
  return {
    short: line,
    full: `${line}, ${address.city}, ${address.region} ${address.postalCode}`
  };
}

function approvalPreview(effect: ReturnType<typeof buildCalendarHoldEffectPayload>) {
  const offsetLabel =
    new Intl.DateTimeFormat("en-US", {
      timeZone: effect.timeZone,
      timeZoneName: "longOffset"
    })
      .formatToParts(new Date(effect.startsAt))
      .find((part) => part.type === "timeZoneName")?.value ?? effect.timeZone;
  return CalendarHoldApprovalPreviewSchema.parse({
    ...effect,
    localTimeLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: effect.timeZone,
      dateStyle: "full",
      timeStyle: "short"
    }).format(new Date(effect.startsAt)),
    offsetLabel: `${effect.timeZone} (${offsetLabel})`,
    payloadHash: computeCalendarPayloadHash(effect)
  });
}

function preparationFromViewing(viewing: Viewing): {
  readonly contactNotes: string | null;
  readonly remindersMinutesBeforeStart: readonly number[];
} {
  return {
    contactNotes: viewing.notes,
    remindersMinutesBeforeStart: ReminderMinutesSchema.parse(
      viewing.metadata[HOLD_PREPARATION_REMINDERS_KEY]
    )
  };
}

function activity(input: {
  readonly id: string;
  readonly correlationId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payloadHash: string;
  readonly occurredAt: string;
  readonly actor?: ActivityEvent["actor"];
  readonly approvalId?: string | null;
  readonly policyDecision?: ActivityEvent["policyDecision"];
  readonly outcome?: ActivityEvent["outcome"];
  readonly errorCategory?: ErrorCategory | null;
  readonly metadata?: ActivityEvent["metadata"];
}): ActivityEvent {
  return ActivityEventSchema.parse({
    id: input.id,
    correlationId: input.correlationId,
    causationId: null,
    actor: input.actor ?? "user",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    policyDecision: input.policyDecision ?? "not_applicable",
    approvalId: input.approvalId ?? null,
    payloadHash: input.payloadHash,
    outcome: input.outcome ?? "recorded",
    errorCategory: input.errorCategory ?? null,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt
  });
}

function recoveryFor(state: AvailabilityCheckState) {
  switch (state) {
    case "checked":
      return {
        action: "none" as const,
        message: "Primary Calendar conflicts were checked.",
        authorizationCapability: null
      };
    case "scope_not_granted":
      return {
        action: "connect" as const,
        message: "Calendar conflicts were not checked because free/busy permission is missing.",
        authorizationCapability: "calendar_conflict_checking" as const
      };
    case "google_disconnected":
      return {
        action: "reconnect" as const,
        message: "Calendar conflicts were not checked because Google Calendar is disconnected.",
        authorizationCapability: "calendar_conflict_checking" as const
      };
    case "google_temporarily_unavailable":
      return {
        action: "retry" as const,
        message: "Google Calendar is temporarily unavailable; conflicts were not checked.",
        authorizationCapability: null
      };
    case "stale":
      return {
        action: "retry" as const,
        message: "The Calendar check is stale and must be refreshed.",
        authorizationCapability: null
      };
    case "vera_rules_only":
      return {
        action: "continue_with_warning" as const,
        message:
          "Conflict checking is intentionally disabled. These windows use Vera availability rules only.",
        authorizationCapability: null
      };
  }
}

function providerFailureState(error: unknown): {
  readonly state: Exclude<AvailabilityCheckState, "checked" | "stale">;
  readonly attempted: boolean;
  readonly safeErrorCode: string | null;
} {
  if (error instanceof CalendarProviderError) {
    if (error.code === "calendar_scope_not_granted") {
      return { state: "scope_not_granted", attempted: false, safeErrorCode: null };
    }
    if (
      ["calendar_disconnected", "calendar_auth_revoked", "calendar_permission_denied"].includes(
        error.code
      )
    ) {
      return { state: "google_disconnected", attempted: false, safeErrorCode: null };
    }
    return {
      state: "google_temporarily_unavailable",
      attempted: true,
      safeErrorCode: error.code
    };
  }
  return {
    state: "google_temporarily_unavailable",
    attempted: true,
    safeErrorCode: "calendar_transient_failure"
  };
}

function expandedRange(window: ProposedViewingWindow): {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly paddingMilliseconds: number;
} {
  const paddingMilliseconds =
    (window.rules.travelMinutes + window.rules.bufferMinutes) * 60 * 1_000;
  return {
    startsAt: new Date(Date.parse(window.startsAt) - paddingMilliseconds).toISOString(),
    endsAt: new Date(Date.parse(window.endsAt) + paddingMilliseconds).toISOString(),
    paddingMilliseconds
  };
}

function hasConflict(
  window: ProposedViewingWindow,
  busyIntervals: FreeBusyResult["busyIntervals"],
  paddingMilliseconds: number
): boolean {
  const startsAt = Date.parse(window.startsAt);
  const endsAt = Date.parse(window.endsAt);
  return busyIntervals.some(
    (busy) =>
      Date.parse(busy.startsAt) - paddingMilliseconds < endsAt &&
      Date.parse(busy.endsAt) + paddingMilliseconds > startsAt
  );
}

function lookupMatches(
  lookup: Exclude<CalendarHoldLookup, { exists: false }>,
  hold: CalendarHold,
  selectedWindow: ProposedViewingWindow
): boolean {
  return (
    lookup.eventId === hold.googleEventId &&
    lookup.veraMarker === `VERA-HOLD:${hold.id}` &&
    lookup.startsAt === selectedWindow.startsAt &&
    lookup.endsAt === selectedWindow.endsAt &&
    lookup.status === "tentative"
  );
}

function safeProviderFailure(error: unknown): {
  readonly code: string;
  readonly retryable: boolean;
  readonly category: ErrorCategory;
} {
  if (error instanceof CalendarHoldServiceError && error.code === "policy_denied") {
    return { code: "calendar_policy_denied", retryable: false, category: "policy_denial" };
  }
  if (error instanceof CalendarProviderError) {
    const category: ErrorCategory =
      error.code === "calendar_rate_limited"
        ? "rate_limit"
        : error.retryable
          ? "transient_provider"
          : error.code === "calendar_conflict_detected"
            ? "conflict"
            : error.code === "calendar_auth_revoked" || error.code === "calendar_disconnected"
              ? "authentication"
              : "permanent_provider";
    return { code: error.code, retryable: error.retryable, category };
  }
  return { code: "calendar_creation_failed", retryable: false, category: "internal" };
}

export function createCalendarHoldService(
  dependencies: CalendarHoldServiceDependencies
): CalendarHoldService {
  const userId = VeraUserIdSchema.parse(dependencies.userId);
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const idFactory = dependencies.idFactory ?? randomUUID;
  const availabilityService =
    dependencies.availabilityService ??
    createCalendarAvailabilityService({
      userId,
      repositories: dependencies.repositories,
      calendar: dependencies.calendar,
      idFactory
    });
  const policyRegistryFactory =
    dependencies.policyRegistryFactory ??
    (() => createPersistedPolicyRegistry(dependencies.repositories));

  function now(): string {
    return IsoDateTimeSchema.parse(clock());
  }

  async function requiredViewing(viewingIdInput: string): Promise<Viewing> {
    const viewingId = EntityIdSchema.parse(viewingIdInput);
    const viewing = await dependencies.repositories.viewings.getById(viewingId);
    if (viewing === null) {
      throw new CalendarHoldServiceError("not_found", "Viewing not found.", 404);
    }
    return viewing;
  }

  async function requiredHold(holdIdInput: string): Promise<CalendarHold> {
    const holdId = EntityIdSchema.parse(holdIdInput);
    const hold = await dependencies.repositories.calendarHolds.getById(holdId);
    if (hold === null) {
      throw new CalendarHoldServiceError("not_found", "Calendar hold not found.", 404);
    }
    return hold;
  }

  async function effectContext(viewingInput: Viewing): Promise<EffectContext> {
    const viewing = ViewingSchema.parse(viewingInput);
    const listing = await dependencies.repositories.canonicalListings.getById(
      viewing.canonicalListingId
    );
    if (listing === null || listing.projectionState !== "active") {
      throw new CalendarHoldServiceError("not_found", "Listing not found.", 404);
    }
    const sourceRecords = await dependencies.repositories.sourceRecords.listByCanonicalListingId(
      listing.id
    );
    const primary = sourceRecords.find((record) => record.id === listing.primarySourceRecordId);
    const prepared = preparationFromViewing(viewing);
    const address = addressParts(listing.address);
    return {
      viewing,
      shortAddress: address.short,
      normalizedAddress: address.full,
      canonicalListingUrl: primary?.sourceUrl ?? null,
      sourceUrls: uniqueSorted(sourceRecords.map((record) => record.sourceUrl)),
      ...prepared
    };
  }

  async function buildPreviewForHold(hold: CalendarHold, viewing: Viewing) {
    const context = await effectContext(viewing);
    if (context.viewing.selectedWindow === null) {
      throw new CalendarHoldServiceError(
        "invalid_state_transition",
        "Select an exact viewing window before preparing a hold.",
        409
      );
    }
    const finalCheckState = hold.conflictCheckOverride
      ? hold.conflictCheckOverrideReason
      : "checked";
    if (finalCheckState === null) {
      throw new CalendarHoldServiceError(
        "validation_failed",
        "Hold override reason is missing.",
        500
      );
    }
    const warning = hold.conflictCheckOverride
      ? "Google Calendar could not be checked. Continue only after reviewing the visible conflict warning."
      : null;
    return approvalPreview(
      buildCalendarHoldEffectPayload({
        holdId: hold.id,
        userId,
        viewingId: viewing.id,
        shortAddress: context.shortAddress,
        normalizedAddress: context.normalizedAddress,
        canonicalListingUrl: context.canonicalListingUrl,
        sourceUrls: context.sourceUrls,
        contactNotes: context.contactNotes,
        selectedWindow: context.viewing.selectedWindow,
        remindersMinutesBeforeStart: context.remindersMinutesBeforeStart,
        finalCheckState,
        conflictCheckOverride: hold.conflictCheckOverride,
        conflictWarning: warning
      })
    );
  }

  async function reservePreview(input: {
    readonly viewing: Viewing;
    readonly finalCheckState: AvailabilityCheckState;
    readonly conflictCheckOverride: boolean;
    readonly availabilityCheckId: string | null;
  }): Promise<{ readonly hold: CalendarHold; readonly preview: CalendarHoldApprovalPreview }> {
    const context = await effectContext(input.viewing);
    if (context.viewing.selectedWindow === null) {
      throw new CalendarHoldServiceError(
        "invalid_state_transition",
        "Select an exact viewing window before preparing a hold.",
        409
      );
    }
    const idempotencyKey = sha256Text(
      `calendar-hold-reservation:v1:${canonicalJson(
        JsonValueSchema.parse({
          userId,
          viewingId: context.viewing.id,
          selectedWindow: context.viewing.selectedWindow,
          contactNotes: context.contactNotes,
          remindersMinutesBeforeStart: context.remindersMinutesBeforeStart,
          finalCheckState: input.finalCheckState,
          conflictCheckOverride: input.conflictCheckOverride,
          availabilityCheckId: input.availabilityCheckId
        })
      )}`
    );
    const existing =
      await dependencies.repositories.calendarHolds.getByIdempotencyKey(idempotencyKey);
    const holdId = existing?.id ?? EntityIdSchema.parse(idFactory());
    const warning = input.conflictCheckOverride
      ? "Google Calendar could not be checked. Continue only after reviewing the visible conflict warning."
      : null;
    const effect = buildCalendarHoldEffectPayload({
      holdId,
      userId,
      viewingId: context.viewing.id,
      shortAddress: context.shortAddress,
      normalizedAddress: context.normalizedAddress,
      canonicalListingUrl: context.canonicalListingUrl,
      sourceUrls: context.sourceUrls,
      contactNotes: context.contactNotes,
      selectedWindow: context.viewing.selectedWindow,
      remindersMinutesBeforeStart: context.remindersMinutesBeforeStart,
      finalCheckState: input.finalCheckState,
      conflictCheckOverride: input.conflictCheckOverride,
      conflictWarning: warning
    });
    const payloadHash = computeCalendarPayloadHash(effect);
    const googleEventId = computeGoogleEventId({
      userId,
      viewingId: context.viewing.id,
      startsAt: context.viewing.selectedWindow.startsAt,
      endsAt: context.viewing.selectedWindow.endsAt,
      payloadHash
    });
    const timestamp = now();
    const candidate = CalendarHoldSchema.parse({
      id: holdId,
      viewingId: context.viewing.id,
      approvalId: null,
      availabilityCheckId: input.availabilityCheckId,
      payloadHash,
      idempotencyKey,
      googleEventId,
      providerEventReference: null,
      state: "approval_pending",
      conflictCheckOverride: input.conflictCheckOverride,
      conflictCheckOverrideReason: input.conflictCheckOverride ? input.finalCheckState : null,
      safeErrorCode: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: existing?.updatedAt ?? timestamp,
      completedAt: null
    });
    const hold = existing ?? (await dependencies.repositories.calendarHolds.insert(candidate));
    if (
      hold.state !== "approval_pending" ||
      hold.payloadHash !== payloadHash ||
      hold.googleEventId !== googleEventId
    ) {
      throw new CalendarHoldServiceError(
        "approval_payload_mismatch",
        "The existing Calendar hold reservation does not match this preview.",
        409
      );
    }
    const preview = approvalPreview(effect);
    return CalendarHoldPreviewResponseSchema.parse({ hold, preview });
  }

  async function appendFinalCheck(input: {
    readonly viewing: Viewing;
    readonly correlationId: string;
  }): Promise<FinalCheckResult> {
    const selectedWindow = input.viewing.selectedWindow;
    if (selectedWindow === null) {
      throw new CalendarHoldServiceError(
        "invalid_state_transition",
        "The Viewing has no selected interval.",
        409
      );
    }
    const rules = await dependencies.repositories.availabilityRuleSets.getCurrent();
    if (rules === null) {
      throw new CalendarHoldServiceError(
        "validation_failed",
        "Viewing availability rules are not configured.",
        409
      );
    }
    const checkedAt = now();
    const selectedRange = expandedRange(selectedWindow);
    const range = {
      startsAt: new Date(
        Math.min(Date.parse(checkedAt), Date.parse(selectedRange.startsAt))
      ).toISOString(),
      endsAt: new Date(
        Math.max(
          Date.parse(checkedAt) + REPLACEMENT_HORIZON_MILLISECONDS,
          Date.parse(selectedRange.endsAt)
        )
      ).toISOString()
    };
    const connections = (await dependencies.repositories.integrationConnections.list()).filter(
      (connection) => connection.provider === "google"
    );
    const connection = connections.length === 1 ? connections[0]! : null;
    const checkId = EntityIdSchema.parse(idFactory());

    if (!rules.conflictCheckingEnabled) {
      const check = await dependencies.repositories.availabilityChecks.append(
        AvailabilityCheckSchema.parse({
          id: checkId,
          availabilityRuleSetId: rules.id,
          integrationConnectionId: connection?.id ?? null,
          state: "vera_rules_only",
          rangeStartsAt: range.startsAt,
          rangeEndsAt: range.endsAt,
          calendarIdsAttempted: [],
          calendarsChecked: [],
          checkedAt: null,
          responseHash: null,
          busyIntervalCount: null,
          safeProviderErrorCode: null,
          correlationId: input.correlationId,
          createdAt: checkedAt
        })
      );
      return { check, busyIntervals: [] };
    }

    try {
      const client = await dependencies.calendar.createClient(userId, FREE_BUSY_SCOPE);
      const result = await client.queryFreeBusy({
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        timeZone: selectedWindow.timeZone,
        calendarIds: ["primary"]
      });
      const responseHash = sha256Text(
        canonicalJson(
          JsonValueSchema.parse({
            checkedAt: result.checkedAt,
            calendarsChecked: result.calendarsChecked,
            busyIntervals: result.busyIntervals
          })
        )
      );
      const check = await dependencies.repositories.availabilityChecks.append(
        AvailabilityCheckSchema.parse({
          id: checkId,
          availabilityRuleSetId: rules.id,
          integrationConnectionId: connection?.id ?? null,
          state: "checked",
          rangeStartsAt: range.startsAt,
          rangeEndsAt: range.endsAt,
          calendarIdsAttempted: ["primary"],
          calendarsChecked: ["primary"],
          checkedAt: result.checkedAt,
          responseHash,
          busyIntervalCount: result.busyIntervals.length,
          safeProviderErrorCode: null,
          correlationId: input.correlationId,
          createdAt: checkedAt
        })
      );
      return { check, busyIntervals: result.busyIntervals };
    } catch (error: unknown) {
      const degraded = providerFailureState(error);
      const check = await dependencies.repositories.availabilityChecks.append(
        AvailabilityCheckSchema.parse({
          id: checkId,
          availabilityRuleSetId: rules.id,
          integrationConnectionId: connection?.id ?? null,
          state: degraded.state,
          rangeStartsAt: range.startsAt,
          rangeEndsAt: range.endsAt,
          calendarIdsAttempted: degraded.attempted ? ["primary"] : [],
          calendarsChecked: [],
          checkedAt: null,
          responseHash: null,
          busyIntervalCount: null,
          safeProviderErrorCode: degraded.safeErrorCode,
          correlationId: input.correlationId,
          createdAt: checkedAt
        })
      );
      return { check, busyIntervals: [] };
    }
  }

  async function revokeApprovedReservation(input: {
    readonly hold: CalendarHold;
    readonly approval: Approval;
    readonly check: AvailabilityCheck;
    readonly action: "calendar.hold_final_check_conflict" | "calendar.hold_final_check_unavailable";
    readonly correlationId: string;
  }): Promise<void> {
    const timestamp = now();
    await dependencies.repositoryProvider.transaction(userId, async (repositories) => {
      const currentApproval = await repositories.approvals.getById(input.approval.id);
      const currentHold = await repositories.calendarHolds.getById(input.hold.id);
      if (currentApproval === null || currentHold === null) {
        throw new RepositoryNotFoundError("Calendar approval reservation", input.hold.id);
      }
      if (currentApproval.state !== "pending" || currentHold.state !== "approved") {
        throw new CalendarHoldServiceError(
          "invalid_state_transition",
          "The Calendar approval was already consumed or revoked.",
          409
        );
      }
      await repositories.approvals.transition(currentApproval.id, "pending", "revoked", timestamp);
      await repositories.calendarHolds.transition(
        currentHold.id,
        "approved",
        "cancelled_internal",
        timestamp,
        { availabilityCheckId: input.check.id, completedAt: timestamp }
      );
      await repositories.activityEvents.append(
        activity({
          id: EntityIdSchema.parse(idFactory()),
          correlationId: input.correlationId,
          action: input.action,
          targetType: "calendar_hold",
          targetId: currentHold.id,
          approvalId: currentApproval.id,
          payloadHash: currentHold.payloadHash,
          policyDecision: "authorized",
          outcome: "recorded",
          occurredAt: timestamp,
          metadata: {
            holdId: currentHold.id,
            viewingId: currentHold.viewingId,
            availabilityCheckId: input.check.id,
            state: input.check.state
          }
        })
      );
    });
  }

  async function persistReplacementViewing(input: {
    readonly current: Viewing;
    readonly check: AvailabilityCheck;
    readonly busyIntervals: FreeBusyResult["busyIntervals"];
    readonly correlationId: string;
  }): Promise<Viewing> {
    const timestamp = now();
    const rules = await dependencies.repositories.availabilityRuleSets.getCurrent();
    if (rules === null) {
      throw new CalendarHoldServiceError("validation_failed", "Selected rules are missing.", 500);
    }
    const windows = generateViewingWindows({
      now: timestamp,
      rules,
      horizonDays: 14,
      availability: {
        state: "checked",
        checkId: input.check.id,
        checkedAt: input.check.checkedAt!,
        calendarIds: ["primary"],
        busy: input.busyIntervals
      }
    });
    const replacement = ViewingSchema.parse({
      id: EntityIdSchema.parse(idFactory()),
      canonicalListingId: input.current.canonicalListingId,
      proposedWindows: windows,
      selectedWindow: null,
      confirmedWindow: null,
      supersedesViewingId: input.current.id,
      timeZone: input.current.timeZone,
      calendarReference: null,
      state: "proposed",
      notes: null,
      metadata: { availabilityCheckId: input.check.id },
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return dependencies.repositoryProvider.transaction(userId, async (repositories) => {
      const current = await repositories.viewings.getById(input.current.id);
      if (current === null || current.state !== "hold_approved") {
        throw new CalendarHoldServiceError(
          "invalid_state_transition",
          "The conflicted Viewing changed before replacement windows were persisted.",
          409
        );
      }
      const persisted = await repositories.viewings.insert(replacement);
      await repositories.viewings.transition(current.id, "hold_approved", "cancelled", timestamp);
      await repositories.activityEvents.append(
        activity({
          id: EntityIdSchema.parse(idFactory()),
          correlationId: input.correlationId,
          action: "viewing.proposals_created",
          targetType: "viewing",
          targetId: persisted.id,
          payloadHash: sha256Text(canonicalJson(JsonValueSchema.parse(windows))),
          occurredAt: timestamp,
          metadata: {
            viewingId: persisted.id,
            listingId: persisted.canonicalListingId,
            availabilityCheckId: input.check.id,
            windowCount: windows.length
          }
        })
      );
      return persisted;
    });
  }

  async function assertWritePolicy(): Promise<void> {
    const registry = await policyRegistryFactory();
    const decision = registry.evaluate({
      connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
      acquisitionMode: "official_api",
      capability: "calendar.hold.create",
      execution: "manual",
      operation: "calendar.hold.create_tentative",
      hasUserSession: true,
      hasApproval: true,
      network: {
        origin: "https://www.googleapis.com/",
        domain: "www.googleapis.com",
        httpMethod: "POST"
      }
    });
    if (!decision.allowed) {
      throw new CalendarHoldServiceError(
        "policy_denied",
        `Calendar creation is disabled by source policy (${decision.reason}).`,
        403
      );
    }
  }

  async function recordPreCreationPolicyDenial(input: {
    readonly hold: CalendarHold;
    readonly approval: Approval;
    readonly correlationId: string;
  }): Promise<void> {
    const timestamp = now();
    await dependencies.repositoryProvider.transaction(userId, async (repositories) => {
      const currentHold = await repositories.calendarHolds.getById(input.hold.id);
      const currentApproval = await repositories.approvals.getById(input.approval.id);
      if (currentHold === null || currentApproval === null) return;
      if (currentApproval.state === "pending") {
        await repositories.approvals.transition(
          currentApproval.id,
          "pending",
          "revoked",
          timestamp
        );
      }
      if (["approved", "retryable_failed"].includes(currentHold.state)) {
        await repositories.calendarHolds.transition(
          currentHold.id,
          currentHold.state,
          "cancelled_internal",
          timestamp,
          { completedAt: timestamp }
        );
      }
      await repositories.activityEvents.append(
        activity({
          id: EntityIdSchema.parse(idFactory()),
          correlationId: input.correlationId,
          action: "calendar.hold_creation_failed",
          targetType: "calendar_hold",
          targetId: currentHold.id,
          approvalId: currentApproval.id,
          payloadHash: currentHold.payloadHash,
          policyDecision: "denied",
          outcome: "failed",
          errorCategory: "policy_denial",
          occurredAt: timestamp,
          metadata: { retryable: false, safeErrorCode: "calendar_policy_denied" }
        })
      );
    });
  }

  async function writeClient(): Promise<CalendarClient> {
    if (dependencies.calendar.configurationState === "unconfigured") {
      throw new CalendarHoldServiceError(
        "calendar_disconnected",
        "Google Calendar is not connected.",
        409
      );
    }
    if (dependencies.calendar.configurationState === "configured") {
      const connections = (await dependencies.repositories.integrationConnections.list()).filter(
        (connection) => connection.provider === "google"
      );
      const connection = connections.length === 1 ? (connections[0] ?? null) : null;
      if (
        connection === null ||
        !["connected", "partial"].includes(connection.status) ||
        !connection.grantedScopes.includes(HOLD_SCOPE)
      ) {
        throw new CalendarHoldServiceError(
          connection === null ? "calendar_disconnected" : "calendar_scope_not_granted",
          "Google Calendar hold permission is required separately.",
          409
        );
      }
    }
    try {
      return await dependencies.calendar.createClient(userId, HOLD_SCOPE);
    } catch (error: unknown) {
      if (error instanceof CalendarProviderError && error.code === "calendar_scope_not_granted") {
        throw new CalendarHoldServiceError(
          "calendar_scope_not_granted",
          "Google Calendar hold permission is required separately.",
          409
        );
      }
      throw new CalendarHoldServiceError(
        "calendar_disconnected",
        "Google Calendar must be reconnected before creating a hold.",
        409
      );
    }
  }

  async function finalizeExisting(
    hold: CalendarHold,
    viewing: Viewing,
    correlationId: string,
    duplicate: boolean
  ): Promise<CreateApprovedCalendarHoldResponse> {
    const timestamp = now();
    const result = await finalizeCalendarHoldCreation(dependencies.repositoryProvider, userId, {
      holdId: hold.id,
      viewingId: viewing.id,
      providerEventReference: hold.googleEventId,
      finalizedAt: timestamp,
      activityEvent: activity({
        id: EntityIdSchema.parse(idFactory()),
        correlationId,
        action: "calendar.hold_created",
        targetType: "calendar_hold",
        targetId: hold.id,
        approvalId: hold.approvalId,
        payloadHash: hold.payloadHash,
        policyDecision: "authorized",
        outcome: "succeeded",
        occurredAt: timestamp,
        metadata: { holdId: hold.id, viewingId: viewing.id, calendarId: "primary" }
      })
    });
    return CreateApprovedCalendarHoldResponseSchema.parse({
      kind: "created",
      hold: result.hold,
      duplicate: duplicate || result.replayed
    });
  }

  async function overridePreviewFromFailedReservation(
    input: CreateOverridePreviewInput
  ): Promise<CreateConflictCheckOverrideResponse> {
    const viewing = await requiredViewing(input.viewingId);
    const original = await requiredHold(input.holdId);
    if (
      original.viewingId !== viewing.id ||
      original.payloadHash !== input.expectedPayloadHash ||
      original.conflictCheckOverride ||
      original.state !== "cancelled_internal" ||
      original.availabilityCheckId === null ||
      viewing.state !== "hold_approved"
    ) {
      throw new CalendarHoldServiceError(
        "approval_payload_mismatch",
        "A new override preview requires the exact failed final-check reservation.",
        409
      );
    }
    const check = await dependencies.repositories.availabilityChecks.getById(
      original.availabilityCheckId
    );
    if (check === null || check.state === "checked") {
      throw new CalendarHoldServiceError(
        "viewing_conflict_detected",
        "A known Calendar conflict can never be overridden.",
        409
      );
    }
    return CreateConflictCheckOverrideResponseSchema.parse(
      await reservePreview({
        viewing,
        finalCheckState: check.state,
        conflictCheckOverride: true,
        availabilityCheckId: check.id
      })
    );
  }

  return {
    async proposeViewing(input) {
      const canonicalListingId = EntityIdSchema.parse(input.canonicalListingId);
      const correlationId = EntityIdSchema.parse(input.correlationId);
      const listing = await dependencies.repositories.canonicalListings.getById(canonicalListingId);
      if (listing === null) {
        throw new CalendarHoldServiceError("not_found", "Listing not found.", 404);
      }
      if (
        !(["replied", "tour_proposed", "tour_scheduled"] as const).includes(
          listing.lifecycleState as never
        )
      ) {
        throw new CalendarHoldServiceError(
          "invalid_state_transition",
          "Viewing proposals require a replied or tour-stage listing.",
          409
        );
      }
      const timestamp = now();
      const proposal = await availabilityService.propose({
        userId,
        canonicalListingId,
        now: timestamp,
        correlationId
      });
      const viewing = ViewingSchema.parse({
        id: EntityIdSchema.parse(idFactory()),
        canonicalListingId,
        proposedWindows: proposal.windows,
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: null,
        timeZone:
          proposal.windows[0]?.timeZone ??
          (await dependencies.repositories.availabilityRuleSets.getCurrent())?.timeZone,
        calendarReference: null,
        state: "proposed",
        notes: null,
        metadata: { availabilityCheckId: proposal.availabilityCheck.id },
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const persisted = await dependencies.repositoryProvider.transaction(
        userId,
        async (repositories) => {
          const current = await repositories.canonicalListings.getById(canonicalListingId);
          if (current === null)
            throw new RepositoryNotFoundError("CanonicalListing", canonicalListingId);
          if (
            !(["replied", "tour_proposed", "tour_scheduled"] as const).includes(
              current.lifecycleState as never
            )
          ) {
            throw new CalendarHoldServiceError(
              "invalid_state_transition",
              "Listing state changed before proposals were persisted.",
              409
            );
          }
          const saved = await repositories.viewings.insert(viewing);
          if (current.lifecycleState === "replied") {
            await repositories.canonicalListings.transitionLifecycle(
              current.id,
              "tour_proposed",
              timestamp
            );
          }
          await repositories.activityEvents.append(
            activity({
              id: EntityIdSchema.parse(idFactory()),
              correlationId,
              action: "viewing.proposals_created",
              targetType: "viewing",
              targetId: saved.id,
              payloadHash: sha256Text(canonicalJson(JsonValueSchema.parse(proposal.windows))),
              occurredAt: timestamp,
              metadata: {
                viewingId: saved.id,
                listingId: canonicalListingId,
                availabilityCheckId: proposal.availabilityCheck.id,
                windowCount: proposal.windows.length,
                state: proposal.state
              }
            })
          );
          return saved;
        }
      );
      return CreateViewingProposalsResponseSchema.parse({
        ...proposal,
        viewing: persisted,
        recovery: recoveryFor(proposal.state)
      });
    },

    async selectWindow(input) {
      const viewing = await requiredViewing(input.viewingId);
      const selected = viewing.proposedWindows.find((window) => exactWindow(window, input));
      if (viewing.state !== "proposed" || selected === undefined) {
        throw new CalendarHoldServiceError(
          "invalid_state_transition",
          "Select one exact persisted proposed window.",
          409
        );
      }
      const timestamp = now();
      const correlationId = EntityIdSchema.parse(input.correlationId);
      const persisted = await dependencies.repositoryProvider.transaction(
        userId,
        async (repositories) => {
          const updated = await repositories.viewings.transition(
            viewing.id,
            "proposed",
            "selected",
            timestamp,
            { selectedWindow: selected }
          );
          await repositories.activityEvents.append(
            activity({
              id: EntityIdSchema.parse(idFactory()),
              correlationId,
              action: "viewing.window_selected",
              targetType: "viewing",
              targetId: viewing.id,
              payloadHash: sha256Text(canonicalJson(JsonValueSchema.parse(selected))),
              occurredAt: timestamp,
              metadata: { viewingId: viewing.id }
            })
          );
          return updated;
        }
      );
      return SelectViewingWindowResponseSchema.parse({ viewing: persisted });
    },

    async createPreview(input) {
      const viewing = await requiredViewing(input.viewingId);
      if (viewing.state !== "selected") {
        throw new CalendarHoldServiceError(
          "invalid_state_transition",
          "Only a selected Viewing can prepare a hold.",
          409
        );
      }
      const prepared = await dependencies.repositories.viewings.prepareCalendarHold(
        viewing.id,
        "selected",
        input.contactNotes,
        ReminderMinutesSchema.parse(input.remindersMinutesBeforeStart),
        now()
      );
      // The normal approval authorizes only the effect that may be written after a fresh,
      // successful final check. This is a condition on the later write, not a claim that the
      // preview itself performed that check; the hold route always rechecks before insertion.
      return reservePreview({
        viewing: prepared,
        finalCheckState: "checked",
        conflictCheckOverride: false,
        availabilityCheckId: prepared.selectedWindow?.availabilityCheckId ?? null
      });
    },

    async approvePreview(input) {
      const viewing = await requiredViewing(input.viewingId);
      const hold = await requiredHold(input.holdId);
      if (hold.viewingId !== viewing.id || hold.state !== "approval_pending") {
        throw new CalendarHoldServiceError(
          "approval_payload_mismatch",
          "Approval is not bound to this Viewing reservation.",
          409
        );
      }
      const preview = await buildPreviewForHold(hold, viewing);
      if (
        preview.payloadHash !== input.expectedPayloadHash ||
        preview.payloadHash !== hold.payloadHash
      ) {
        throw new CalendarHoldServiceError(
          "approval_payload_mismatch",
          "The Calendar preview changed; review and approve the rebuilt payload.",
          409
        );
      }
      const approvedAt = now();
      const approvalId = EntityIdSchema.parse(idFactory());
      const approval = ApprovalSchema.parse({
        id: approvalId,
        actor: "user",
        connectorId: GOOGLE_CALENDAR_CONNECTOR_ID,
        operation: hold.conflictCheckOverride
          ? "calendar.hold.create_without_conflict_check"
          : "calendar.hold.create",
        targetType: "calendar_hold",
        targetId: hold.id,
        payloadHash: hold.payloadHash,
        state: "pending",
        createdAt: approvedAt,
        expiresAt: new Date(Date.parse(approvedAt) + APPROVAL_TTL_MILLISECONDS).toISOString(),
        usedAt: null
      });
      const approvedHold = CalendarHoldSchema.parse({
        ...hold,
        approvalId,
        state: "approved",
        updatedAt: approvedAt
      });
      const result = await approveCalendarHold(dependencies.repositoryProvider, userId, {
        approval,
        hold: approvedHold,
        selectedWindow: viewing.selectedWindow!,
        approvedAt,
        activityEvent: activity({
          id: EntityIdSchema.parse(idFactory()),
          correlationId: EntityIdSchema.parse(input.correlationId),
          action: hold.conflictCheckOverride
            ? "calendar.hold_override_approved"
            : "calendar.hold_approval_recorded",
          targetType: "calendar_hold",
          targetId: hold.id,
          approvalId,
          payloadHash: hold.payloadHash,
          policyDecision: "authorized",
          outcome: "authorized",
          occurredAt: approvedAt,
          metadata: { approvalId, holdId: hold.id, viewingId: viewing.id }
        })
      });
      return { approval: result.approval, hold: result.hold };
    },

    async createApprovedHold(input) {
      const viewing = await requiredViewing(input.viewingId);
      const approvalId = EntityIdSchema.parse(input.approvalId);
      const approval = await dependencies.repositories.approvals.getById(approvalId);
      if (approval === null) {
        throw new CalendarHoldServiceError("approval_required", "Approval not found.", 409);
      }
      const hold = await requiredHold(approval.targetId);
      if (
        hold.viewingId !== viewing.id ||
        hold.approvalId !== approval.id ||
        hold.payloadHash !== input.expectedPayloadHash ||
        approval.payloadHash !== input.expectedPayloadHash ||
        hold.conflictCheckOverride !== input.conflictCheckOverride
      ) {
        throw new CalendarHoldServiceError(
          "approval_payload_mismatch",
          "Approval does not match the exact reserved Calendar effect.",
          409
        );
      }
      if (hold.state === "created") {
        return CreateApprovedCalendarHoldResponseSchema.parse({
          kind: "created",
          hold,
          duplicate: true
        });
      }
      if (approval.state === "pending" && Date.parse(approval.expiresAt) <= Date.parse(now())) {
        await dependencies.repositories.approvals.transition(
          approval.id,
          "pending",
          "expired",
          now()
        );
        throw new CalendarHoldServiceError(
          "approval_expired",
          "The Calendar approval expired; review a new preview.",
          409
        );
      }
      if (!(["pending", "used"] as const).includes(approval.state as never)) {
        throw new CalendarHoldServiceError(
          "approval_required",
          "A new Calendar approval is required.",
          409
        );
      }

      let finalCheckId = hold.availabilityCheckId;
      if (!hold.conflictCheckOverride) {
        const finalCheck = await appendFinalCheck({
          viewing,
          correlationId: EntityIdSchema.parse(input.correlationId)
        });
        finalCheckId = finalCheck.check.id;
        if (finalCheck.check.state !== "checked") {
          await revokeApprovedReservation({
            hold,
            approval,
            check: finalCheck.check,
            action: "calendar.hold_final_check_unavailable",
            correlationId: input.correlationId
          });
          const override = await overridePreviewFromFailedReservation({
            viewingId: viewing.id,
            holdId: hold.id,
            expectedPayloadHash: hold.payloadHash
          });
          return CreateApprovedCalendarHoldResponseSchema.parse({
            kind: "confirmation_required",
            overridePreview: override.preview,
            recovery: {
              action: "continue_with_warning",
              message:
                "The final Google Calendar check failed. Review and approve a new warned preview to continue.",
              authorizationCapability: null
            }
          });
        }
        const padding = expandedRange(viewing.selectedWindow!).paddingMilliseconds;
        if (hasConflict(viewing.selectedWindow!, finalCheck.busyIntervals, padding)) {
          await revokeApprovedReservation({
            hold,
            approval,
            check: finalCheck.check,
            action: "calendar.hold_final_check_conflict",
            correlationId: input.correlationId
          });
          const replacement = await persistReplacementViewing({
            current: viewing,
            check: finalCheck.check,
            busyIntervals: finalCheck.busyIntervals,
            correlationId: input.correlationId
          });
          return CreateApprovedCalendarHoldResponseSchema.parse({
            kind: "conflict_detected",
            replacementViewingId: replacement.id,
            replacementWindows: replacement.proposedWindows,
            recovery: {
              action: "choose_replacement",
              message: "A new conflict appeared. Choose a newly checked replacement window.",
              authorizationCapability: null
            }
          });
        }
      } else {
        const check =
          finalCheckId === null
            ? null
            : await dependencies.repositories.availabilityChecks.getById(finalCheckId);
        if (check === null || check.state === "checked") {
          throw new CalendarHoldServiceError(
            "viewing_conflict_detected",
            "A known Calendar conflict can never be overridden.",
            409
          );
        }
      }

      try {
        await assertWritePolicy();
      } catch (error: unknown) {
        if (error instanceof CalendarHoldServiceError && error.code === "policy_denied") {
          await recordPreCreationPolicyDenial({
            hold,
            approval,
            correlationId: input.correlationId
          });
        }
        throw error;
      }
      const client = await writeClient();
      let creatingHold = hold;
      if (hold.state === "approved" || hold.state === "retryable_failed") {
        const begun = await beginCalendarHoldCreation(dependencies.repositoryProvider, userId, {
          holdId: hold.id,
          viewingId: viewing.id,
          approvalId: approval.id,
          payloadHash: hold.payloadHash,
          idempotencyKey: hold.idempotencyKey,
          selectedWindow: viewing.selectedWindow!,
          requestedAt: now(),
          ...(finalCheckId === null ? {} : { availabilityCheckId: finalCheckId })
        });
        creatingHold = begun.hold;
      } else if (hold.state !== "creating") {
        throw new CalendarHoldServiceError(
          "invalid_state_transition",
          "Calendar hold creation is not retryable from its current state.",
          409
        );
      }

      try {
        const preview = await buildPreviewForHold(creatingHold, viewing);
        if (preview.payloadHash !== creatingHold.payloadHash) {
          throw new CalendarHoldServiceError(
            "approval_payload_mismatch",
            "The approved Calendar payload changed before creation.",
            409
          );
        }
        const exactRequest = buildInsertTentativeHoldRequest({
          effect: {
            holdId: preview.holdId,
            viewingId: preview.viewingId,
            veraMarker: preview.veraMarker,
            title: preview.title,
            startsAt: preview.startsAt,
            endsAt: preview.endsAt,
            timeZone: preview.timeZone,
            normalizedAddress: preview.normalizedAddress,
            description: preview.description,
            remindersMinutesBeforeStart: preview.remindersMinutesBeforeStart,
            calendarId: preview.calendarId,
            attendeeCount: preview.attendeeCount,
            conferencing: preview.conferencing,
            notifications: preview.notifications,
            status: preview.status,
            visibility: preview.visibility,
            transparency: preview.transparency,
            finalCheckState: preview.finalCheckState,
            conflictCheckOverride: preview.conflictCheckOverride,
            warning: preview.warning
          },
          eventId: creatingHold.googleEventId
        });
        const lookup = await client.getTentativeHold({
          calendarId: "primary",
          eventId: creatingHold.googleEventId
        });
        if (lookup.exists) {
          if (!lookupMatches(lookup, creatingHold, viewing.selectedWindow!)) {
            throw new CalendarProviderError("calendar_conflict_detected", false, 409);
          }
          return finalizeExisting(creatingHold, viewing, input.correlationId, true);
        }
        // Source policy and kill switches are re-read directly before the provider write.
        await assertWritePolicy();
        await client.insertTentativeHold(exactRequest);
        return finalizeExisting(creatingHold, viewing, input.correlationId, false);
      } catch (error: unknown) {
        const failure = safeProviderFailure(error);
        try {
          await failCalendarHoldCreation(dependencies.repositoryProvider, userId, {
            holdId: creatingHold.id,
            retryable: failure.retryable,
            safeErrorCode: failure.code,
            errorCategory: failure.category,
            failedAt: now(),
            activityEvent: activity({
              id: EntityIdSchema.parse(idFactory()),
              correlationId: input.correlationId,
              action: "calendar.hold_creation_failed",
              targetType: "calendar_hold",
              targetId: creatingHold.id,
              approvalId: creatingHold.approvalId,
              payloadHash: creatingHold.payloadHash,
              policyDecision:
                error instanceof CalendarHoldServiceError && error.code === "policy_denied"
                  ? "denied"
                  : "authorized",
              outcome: "failed",
              errorCategory: failure.category,
              occurredAt: now(),
              metadata: { retryable: failure.retryable, safeErrorCode: failure.code }
            })
          });
        } catch {
          const concurrent = await dependencies.repositories.calendarHolds.getById(creatingHold.id);
          if (concurrent?.state === "created") {
            return CreateApprovedCalendarHoldResponseSchema.parse({
              kind: "created",
              hold: concurrent,
              duplicate: true
            });
          }
        }
        if (error instanceof CalendarHoldServiceError) throw error;
        throw new CalendarHoldServiceError(
          "calendar_creation_failed",
          "The Calendar hold was not created. The failure was recorded safely.",
          failure.retryable ? 503 : 409
        );
      }
    },

    async createOverridePreview(input) {
      return overridePreviewFromFailedReservation(input);
    },

    async reschedule(input) {
      const current = await requiredViewing(input.viewingId);
      const timestamp = now();
      const inheritedWindows = current.proposedWindows.map((window) =>
        window.state === "checked"
          ? {
              ...window,
              state: "stale" as const,
              requiresConflictWarning: true
            }
          : window
      );
      const replacement = ViewingSchema.parse({
        id: EntityIdSchema.parse(idFactory()),
        canonicalListingId: current.canonicalListingId,
        proposedWindows: inheritedWindows,
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: current.id,
        timeZone: current.timeZone,
        calendarReference: null,
        state: "proposed",
        notes: null,
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp
      });
      const result = await startViewingReschedule(dependencies.repositoryProvider, userId, {
        currentViewingId: current.id,
        replacementViewing: replacement,
        startedAt: timestamp,
        activityEvent: activity({
          id: EntityIdSchema.parse(idFactory()),
          correlationId: EntityIdSchema.parse(input.correlationId),
          action: "viewing.reschedule_started",
          targetType: "viewing",
          targetId: replacement.id,
          payloadHash: sha256Text(
            canonicalJson(JsonValueSchema.parse(replacement.proposedWindows))
          ),
          occurredAt: timestamp,
          metadata: { viewingId: replacement.id, listingId: replacement.canonicalListingId }
        })
      });
      return RescheduleViewingResponseSchema.parse({
        viewing: result.replacementViewing,
        externalCleanupRequired: result.manualExternalCleanupRequired,
        warning: result.manualExternalCleanupRequired ? EXTERNAL_CLEANUP_WARNING : null
      });
    },

    async cancel(input) {
      const current = await requiredViewing(input.viewingId);
      const holds = await dependencies.repositories.calendarHolds.listByViewingId(current.id);
      const activeHold = holds.find(
        (hold) => !["permanently_failed", "cancelled_internal"].includes(hold.state)
      );
      const timestamp = now();
      const result = await cancelViewingInternally(dependencies.repositoryProvider, userId, {
        viewingId: current.id,
        ...(activeHold === undefined ? {} : { holdId: activeHold.id }),
        cancelledAt: timestamp,
        activityEvent: activity({
          id: EntityIdSchema.parse(idFactory()),
          correlationId: EntityIdSchema.parse(input.correlationId),
          action: "viewing.cancelled_internal",
          targetType: "viewing",
          targetId: current.id,
          payloadHash: sha256Text(`viewing-cancel:v1:${current.id}`),
          occurredAt: timestamp,
          metadata: { viewingId: current.id, listingId: current.canonicalListingId }
        })
      });
      return {
        viewing: result.viewing,
        externalCleanupRequired: result.manualExternalCleanupRequired,
        warning: result.manualExternalCleanupRequired ? EXTERNAL_CLEANUP_WARNING : null
      };
    }
  };
}
