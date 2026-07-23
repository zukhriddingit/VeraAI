import {
  ActivityEventSchema,
  ApprovalSchema,
  CalendarHoldSchema,
  EntityIdSchema,
  IsoDateTimeSchema,
  ProposedViewingWindowSchema,
  Sha256Schema,
  VeraUserIdSchema,
  ViewingSchema,
  type ActivityEvent,
  type Approval,
  type CalendarHold,
  type ErrorCategory,
  type ProposedViewingWindow,
  type VeraUserId,
  type Viewing
} from "@vera/domain";

import {
  RepositoryNotFoundError,
  type BeginCalendarHoldCreationInput,
  type UserRepositoryProvider
} from "../repositories.ts";

const CALENDAR_ACTIVITY_ACTIONS = new Set([
  "viewing.availability_saved",
  "calendar.authorization_requested",
  "calendar.authorization_completed",
  "calendar.authorization_denied",
  "calendar.freebusy_checked",
  "calendar.freebusy_unavailable",
  "viewing.proposals_created",
  "viewing.window_selected",
  "calendar.hold_approval_recorded",
  "calendar.hold_final_check_conflict",
  "calendar.hold_final_check_unavailable",
  "calendar.hold_override_approved",
  "calendar.hold_created",
  "calendar.hold_creation_failed",
  "viewing.reschedule_started",
  "viewing.cancelled_internal"
]);

const SAFE_CALENDAR_METADATA_KEYS = new Set([
  "approvalId",
  "availabilityCheckId",
  "calendarCount",
  "calendarId",
  "calendarIds",
  "capability",
  "checkedAt",
  "holdId",
  "idempotencyKey",
  "listingId",
  "payloadHash",
  "primaryCalendarOnly",
  "retryable",
  "safeErrorCode",
  "state",
  "viewingId",
  "windowCount"
]);

export class CalendarTransactionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarTransactionInvariantError";
  }
}

function exactWindow(left: ProposedViewingWindow, right: ProposedViewingWindow): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function required<Entity>(entity: Entity | null, type: string, id: string): Entity {
  if (entity === null) throw new RepositoryNotFoundError(type, id);
  return entity;
}

function activity(input: ActivityEvent, expectedAction: string): ActivityEvent {
  const event = ActivityEventSchema.parse(input);
  if (!CALENDAR_ACTIVITY_ACTIONS.has(event.action) || event.action !== expectedAction) {
    throw new CalendarTransactionInvariantError(`Expected ${expectedAction} activity.`);
  }
  for (const key of Object.keys(event.metadata)) {
    if (!SAFE_CALENDAR_METADATA_KEYS.has(key)) {
      throw new CalendarTransactionInvariantError(
        `Calendar activity metadata key ${key} is not in the safe vocabulary.`
      );
    }
  }
  return event;
}

function expectedApprovalOperation(hold: CalendarHold): string {
  return hold.conflictCheckOverride
    ? "calendar.hold.create_without_conflict_check"
    : "calendar.hold.create";
}

function validateApprovalBinding(input: {
  readonly approval: Approval;
  readonly hold: CalendarHold;
  readonly viewing: Viewing;
  readonly selectedWindow: ProposedViewingWindow;
  readonly requestedAt: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
}): void {
  if (input.approval.state !== "pending") {
    throw new CalendarTransactionInvariantError("Calendar hold approval is not pending.");
  }
  if (Date.parse(input.approval.expiresAt) <= Date.parse(input.requestedAt)) {
    throw new CalendarTransactionInvariantError("Calendar hold approval has expired.");
  }
  if (
    input.approval.operation !== expectedApprovalOperation(input.hold) ||
    input.approval.targetType !== "calendar_hold" ||
    input.approval.targetId !== input.hold.id
  ) {
    throw new CalendarTransactionInvariantError(
      "Calendar hold approval operation or target does not match the reserved hold."
    );
  }
  if (
    input.approval.payloadHash !== input.payloadHash ||
    input.hold.payloadHash !== input.payloadHash
  ) {
    throw new CalendarTransactionInvariantError(
      "Calendar hold payload hash does not match approval."
    );
  }
  if (input.hold.idempotencyKey !== input.idempotencyKey) {
    throw new CalendarTransactionInvariantError("Calendar hold idempotency key does not match.");
  }
  if (
    input.hold.viewingId !== input.viewing.id ||
    input.hold.approvalId !== input.approval.id ||
    input.viewing.selectedWindow === null ||
    !exactWindow(input.viewing.selectedWindow, input.selectedWindow)
  ) {
    throw new CalendarTransactionInvariantError(
      "Calendar hold is not bound to the exact selected Viewing window."
    );
  }
}

export interface ApproveCalendarHoldInput {
  readonly approval: Approval;
  readonly hold: CalendarHold;
  readonly selectedWindow: ProposedViewingWindow;
  readonly approvedAt: string;
  readonly activityEvent: ActivityEvent;
}

export async function approveCalendarHold(
  provider: UserRepositoryProvider,
  userIdInput: VeraUserId,
  input: ApproveCalendarHoldInput
): Promise<{
  readonly approval: Approval;
  readonly hold: CalendarHold;
  readonly viewing: Viewing;
}> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const approval = ApprovalSchema.parse(input.approval);
  const hold = CalendarHoldSchema.parse(input.hold);
  const selectedWindow = ProposedViewingWindowSchema.parse(input.selectedWindow);
  const approvedAt = IsoDateTimeSchema.parse(input.approvedAt);
  const audit = activity(
    input.activityEvent,
    hold.conflictCheckOverride
      ? "calendar.hold_override_approved"
      : "calendar.hold_approval_recorded"
  );
  if (
    approval.state !== "pending" ||
    hold.state !== "approved" ||
    hold.approvalId !== approval.id ||
    approval.payloadHash !== hold.payloadHash ||
    approval.operation !== expectedApprovalOperation(hold) ||
    approval.targetType !== "calendar_hold" ||
    approval.targetId !== hold.id ||
    Date.parse(approval.expiresAt) <= Date.parse(approvedAt)
  ) {
    throw new CalendarTransactionInvariantError(
      "Approval and Calendar hold reservation do not match."
    );
  }
  if (
    audit.targetType !== "calendar_hold" ||
    audit.targetId !== hold.id ||
    audit.approvalId !== approval.id ||
    audit.payloadHash !== hold.payloadHash ||
    audit.occurredAt !== approvedAt
  ) {
    throw new CalendarTransactionInvariantError(
      "Calendar hold approval audit is not bound to the effect."
    );
  }

  return provider.transaction(userId, async (repositories) => {
    const viewing = required(
      await repositories.viewings.getById(hold.viewingId),
      "Viewing",
      hold.viewingId
    );
    const expectedViewingState = hold.conflictCheckOverride ? "hold_approved" : "selected";
    if (
      viewing.state !== expectedViewingState ||
      viewing.selectedWindow === null ||
      !exactWindow(viewing.selectedWindow, selectedWindow)
    ) {
      throw new CalendarTransactionInvariantError(
        "Only the exact selected Viewing window can be approved."
      );
    }
    const reservation = required(
      await repositories.calendarHolds.getById(hold.id),
      "CalendarHold",
      hold.id
    );
    if (
      reservation.state !== "approval_pending" ||
      reservation.approvalId !== null ||
      reservation.idempotencyKey !== hold.idempotencyKey ||
      reservation.payloadHash !== hold.payloadHash ||
      reservation.viewingId !== hold.viewingId ||
      reservation.availabilityCheckId !== hold.availabilityCheckId ||
      reservation.googleEventId !== hold.googleEventId ||
      reservation.conflictCheckOverride !== hold.conflictCheckOverride ||
      reservation.conflictCheckOverrideReason !== hold.conflictCheckOverrideReason
    ) {
      throw new CalendarTransactionInvariantError(
        "Approved Calendar hold does not match its persisted approval-pending reservation."
      );
    }
    const persistedApproval = await repositories.approvals.insert(approval);
    const persistedHold = await repositories.calendarHolds.transition(
      reservation.id,
      "approval_pending",
      "approved",
      approvedAt,
      { approvalId: approval.id }
    );
    const persistedViewing = hold.conflictCheckOverride
      ? viewing
      : await repositories.viewings.transition(viewing.id, "selected", "hold_approved", approvedAt);
    await repositories.activityEvents.append(audit);
    return {
      approval: persistedApproval,
      hold: persistedHold,
      viewing: persistedViewing
    };
  });
}

export async function beginCalendarHoldCreation(
  provider: UserRepositoryProvider,
  userIdInput: VeraUserId,
  input: BeginCalendarHoldCreationInput
): Promise<{
  readonly approval: Approval;
  readonly hold: CalendarHold;
  readonly viewing: Viewing;
}> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const holdId = EntityIdSchema.parse(input.holdId);
  const viewingId = EntityIdSchema.parse(input.viewingId);
  const approvalId = EntityIdSchema.parse(input.approvalId);
  const payloadHash = Sha256Schema.parse(input.payloadHash);
  const idempotencyKey = Sha256Schema.parse(input.idempotencyKey);
  const selectedWindow = ProposedViewingWindowSchema.parse(input.selectedWindow);
  const requestedAt = IsoDateTimeSchema.parse(input.requestedAt);
  const availabilityCheckId =
    input.availabilityCheckId === undefined
      ? undefined
      : EntityIdSchema.parse(input.availabilityCheckId);

  return provider.transaction(userId, async (repositories) => {
    const hold = required(await repositories.calendarHolds.getById(holdId), "CalendarHold", holdId);
    const approval = required(
      await repositories.approvals.getById(approvalId),
      "Approval",
      approvalId
    );
    const viewing = required(await repositories.viewings.getById(viewingId), "Viewing", viewingId);
    if (availabilityCheckId !== undefined) {
      required(
        await repositories.availabilityChecks.getById(availabilityCheckId),
        "AvailabilityCheck",
        availabilityCheckId
      );
    }
    if (hold.id !== (await repositories.calendarHolds.getByIdempotencyKey(idempotencyKey))?.id) {
      throw new CalendarTransactionInvariantError(
        "Calendar hold idempotency lookup did not match."
      );
    }
    if (hold.state === "retryable_failed" && approval.state === "used") {
      if (
        hold.payloadHash !== payloadHash ||
        hold.approvalId !== approval.id ||
        hold.viewingId !== viewing.id ||
        approval.payloadHash !== payloadHash ||
        approval.operation !== expectedApprovalOperation(hold) ||
        approval.targetType !== "calendar_hold" ||
        approval.targetId !== hold.id ||
        viewing.selectedWindow === null ||
        !exactWindow(viewing.selectedWindow, selectedWindow)
      ) {
        throw new CalendarTransactionInvariantError(
          "Retry does not match the original Calendar hold."
        );
      }
      const retried = await repositories.calendarHolds.transition(
        hold.id,
        "retryable_failed",
        "creating",
        requestedAt,
        availabilityCheckId === undefined ? {} : { availabilityCheckId }
      );
      return { approval, hold: retried, viewing };
    }
    if (hold.state !== "approved" || viewing.state !== "hold_approved") {
      throw new CalendarTransactionInvariantError("Calendar hold is not ready for creation.");
    }
    validateApprovalBinding({
      approval,
      hold,
      viewing,
      selectedWindow,
      requestedAt,
      payloadHash,
      idempotencyKey
    });
    const consumedApproval = await repositories.approvals.transition(
      approval.id,
      "pending",
      "used",
      requestedAt
    );
    const creatingHold = await repositories.calendarHolds.transition(
      hold.id,
      "approved",
      "creating",
      requestedAt,
      availabilityCheckId === undefined ? {} : { availabilityCheckId }
    );
    return { approval: consumedApproval, hold: creatingHold, viewing };
  });
}

export interface FinalizeCalendarHoldCreationInput {
  readonly holdId: string;
  readonly viewingId: string;
  readonly providerEventReference: string;
  readonly finalizedAt: string;
  readonly activityEvent: ActivityEvent;
}

export async function finalizeCalendarHoldCreation(
  provider: UserRepositoryProvider,
  userIdInput: VeraUserId,
  input: FinalizeCalendarHoldCreationInput
): Promise<{
  readonly hold: CalendarHold;
  readonly viewing: Viewing;
  readonly replayed: boolean;
}> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const holdId = EntityIdSchema.parse(input.holdId);
  const viewingId = EntityIdSchema.parse(input.viewingId);
  const finalizedAt = IsoDateTimeSchema.parse(input.finalizedAt);
  const providerEventReference = input.providerEventReference.trim();
  if (providerEventReference.length < 1 || providerEventReference.length > 300) {
    throw new Error("Calendar provider reference is invalid.");
  }
  const audit = activity(input.activityEvent, "calendar.hold_created");

  return provider.transaction(userId, async (repositories) => {
    const currentHold = required(
      await repositories.calendarHolds.getById(holdId),
      "CalendarHold",
      holdId
    );
    const currentViewing = required(
      await repositories.viewings.getById(viewingId),
      "Viewing",
      viewingId
    );
    if (currentHold.viewingId !== currentViewing.id) {
      throw new CalendarTransactionInvariantError("Calendar hold and Viewing do not match.");
    }
    if (currentHold.state === "created") {
      if (
        currentHold.providerEventReference !== providerEventReference ||
        currentViewing.state !== "hold_created"
      ) {
        throw new CalendarTransactionInvariantError("Created Calendar hold replay does not match.");
      }
      return { hold: currentHold, viewing: currentViewing, replayed: true };
    }
    if (currentHold.state !== "creating" || currentViewing.state !== "hold_approved") {
      throw new CalendarTransactionInvariantError("Calendar hold is not being created.");
    }
    if (
      audit.targetType !== "calendar_hold" ||
      audit.targetId !== currentHold.id ||
      audit.approvalId !== currentHold.approvalId ||
      audit.payloadHash !== currentHold.payloadHash ||
      audit.occurredAt !== finalizedAt
    ) {
      throw new CalendarTransactionInvariantError(
        "Calendar creation audit is not bound to the hold."
      );
    }
    const hold = await repositories.calendarHolds.transition(
      currentHold.id,
      "creating",
      "created",
      finalizedAt,
      { providerEventReference, completedAt: finalizedAt }
    );
    const viewing = await repositories.viewings.transition(
      currentViewing.id,
      "hold_approved",
      "hold_created",
      finalizedAt,
      { calendarReference: providerEventReference }
    );
    const listing = required(
      await repositories.canonicalListings.getById(viewing.canonicalListingId),
      "CanonicalListing",
      viewing.canonicalListingId
    );
    await repositories.canonicalListings.transitionLifecycle(
      listing.id,
      "tour_scheduled",
      finalizedAt
    );
    await repositories.activityEvents.append(audit);
    return { hold, viewing, replayed: false };
  });
}

export interface FailCalendarHoldCreationInput {
  readonly holdId: string;
  readonly retryable: boolean;
  readonly safeErrorCode: string;
  readonly errorCategory: ErrorCategory;
  readonly failedAt: string;
  readonly activityEvent: ActivityEvent;
}

export async function failCalendarHoldCreation(
  provider: UserRepositoryProvider,
  userIdInput: VeraUserId,
  input: FailCalendarHoldCreationInput
): Promise<CalendarHold> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const holdId = EntityIdSchema.parse(input.holdId);
  const failedAt = IsoDateTimeSchema.parse(input.failedAt);
  const safeErrorCode = input.safeErrorCode.trim();
  if (!/^[a-z][a-z0-9_]{0,119}$/u.test(safeErrorCode)) {
    throw new Error("Calendar failure code must be a safe symbolic value.");
  }
  const audit = activity(input.activityEvent, "calendar.hold_creation_failed");
  if (audit.outcome !== "failed" || audit.errorCategory !== input.errorCategory) {
    throw new CalendarTransactionInvariantError("Calendar failure audit category does not match.");
  }
  return provider.transaction(userId, async (repositories) => {
    const current = required(
      await repositories.calendarHolds.getById(holdId),
      "CalendarHold",
      holdId
    );
    if (current.state !== "creating") {
      throw new CalendarTransactionInvariantError("Only a creating Calendar hold can fail.");
    }
    if (
      audit.targetType !== "calendar_hold" ||
      audit.targetId !== current.id ||
      audit.approvalId !== current.approvalId ||
      audit.payloadHash !== current.payloadHash ||
      audit.occurredAt !== failedAt
    ) {
      throw new CalendarTransactionInvariantError(
        "Calendar failure audit is not bound to the hold."
      );
    }
    const hold = await repositories.calendarHolds.transition(
      current.id,
      "creating",
      input.retryable ? "retryable_failed" : "permanently_failed",
      failedAt,
      {
        safeErrorCode,
        completedAt: input.retryable ? null : failedAt
      }
    );
    await repositories.activityEvents.append(audit);
    return hold;
  });
}

export interface CancelViewingInternallyInput {
  readonly viewingId: string;
  readonly holdId?: string;
  readonly cancelledAt: string;
  readonly activityEvent: ActivityEvent;
}

export async function cancelViewingInternally(
  provider: UserRepositoryProvider,
  userIdInput: VeraUserId,
  input: CancelViewingInternallyInput
): Promise<{
  readonly viewing: Viewing;
  readonly manualExternalCleanupRequired: boolean;
}> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const viewingId = EntityIdSchema.parse(input.viewingId);
  const cancelledAt = IsoDateTimeSchema.parse(input.cancelledAt);
  const audit = activity(input.activityEvent, "viewing.cancelled_internal");
  return provider.transaction(userId, async (repositories) => {
    const current = required(await repositories.viewings.getById(viewingId), "Viewing", viewingId);
    if (current.state === "completed" || current.state === "cancelled") {
      throw new CalendarTransactionInvariantError("Viewing is already terminal.");
    }
    const viewing = await repositories.viewings.transition(
      current.id,
      current.state,
      "cancelled",
      cancelledAt
    );
    const listing = required(
      await repositories.canonicalListings.getById(current.canonicalListingId),
      "CanonicalListing",
      current.canonicalListingId
    );
    if (["tour_proposed", "tour_scheduled"].includes(listing.lifecycleState)) {
      await repositories.canonicalListings.transitionLifecycle(listing.id, "replied", cancelledAt);
    }
    if (input.holdId !== undefined) {
      const holdId = EntityIdSchema.parse(input.holdId);
      const hold = required(
        await repositories.calendarHolds.getById(holdId),
        "CalendarHold",
        holdId
      );
      if (hold.viewingId !== viewing.id) {
        throw new CalendarTransactionInvariantError("Calendar hold belongs to another Viewing.");
      }
      if (!["permanently_failed", "cancelled_internal"].includes(hold.state)) {
        await repositories.calendarHolds.transition(
          hold.id,
          hold.state,
          "cancelled_internal",
          cancelledAt,
          { completedAt: cancelledAt }
        );
      }
    }
    if (
      audit.targetType !== "viewing" ||
      audit.targetId !== viewing.id ||
      audit.occurredAt !== cancelledAt
    ) {
      throw new CalendarTransactionInvariantError(
        "Viewing cancellation audit target does not match."
      );
    }
    await repositories.activityEvents.append(audit);
    return {
      viewing,
      manualExternalCleanupRequired: current.calendarReference !== null
    };
  });
}

export interface StartViewingRescheduleInput {
  readonly currentViewingId: string;
  readonly replacementViewing: Viewing;
  readonly startedAt: string;
  readonly activityEvent: ActivityEvent;
}

export async function startViewingReschedule(
  provider: UserRepositoryProvider,
  userIdInput: VeraUserId,
  input: StartViewingRescheduleInput
): Promise<{
  readonly previousViewing: Viewing;
  readonly replacementViewing: Viewing;
  readonly manualExternalCleanupRequired: boolean;
}> {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const currentViewingId = EntityIdSchema.parse(input.currentViewingId);
  const replacement = ViewingSchema.parse(input.replacementViewing);
  const startedAt = IsoDateTimeSchema.parse(input.startedAt);
  const audit = activity(input.activityEvent, "viewing.reschedule_started");
  return provider.transaction(userId, async (repositories) => {
    const current = required(
      await repositories.viewings.getById(currentViewingId),
      "Viewing",
      currentViewingId
    );
    if (
      current.state === "completed" ||
      current.state === "cancelled" ||
      replacement.state !== "proposed" ||
      replacement.canonicalListingId !== current.canonicalListingId ||
      replacement.supersedesViewingId !== current.id ||
      Date.parse(replacement.createdAt) !== Date.parse(startedAt)
    ) {
      throw new CalendarTransactionInvariantError("Replacement Viewing lineage is invalid.");
    }
    const persistedReplacement = await repositories.viewings.insert(replacement);
    const previousViewing = await repositories.viewings.transition(
      current.id,
      current.state,
      "cancelled",
      startedAt
    );
    const activeHolds = (await repositories.calendarHolds.listByViewingId(current.id)).filter(
      (hold) => !["permanently_failed", "cancelled_internal"].includes(hold.state)
    );
    if (activeHolds.length > 1) {
      throw new CalendarTransactionInvariantError(
        "A Viewing cannot have multiple active Calendar holds during reschedule."
      );
    }
    const activeHold = activeHolds[0];
    if (activeHold !== undefined) {
      await repositories.calendarHolds.transition(
        activeHold.id,
        activeHold.state,
        "cancelled_internal",
        startedAt,
        { completedAt: startedAt }
      );
    }
    const listing = required(
      await repositories.canonicalListings.getById(current.canonicalListingId),
      "CanonicalListing",
      current.canonicalListingId
    );
    if (listing.lifecycleState === "tour_scheduled") {
      await repositories.canonicalListings.transitionLifecycle(
        listing.id,
        "tour_proposed",
        startedAt
      );
    }
    if (
      audit.targetType !== "viewing" ||
      audit.targetId !== persistedReplacement.id ||
      audit.occurredAt !== startedAt
    ) {
      throw new CalendarTransactionInvariantError("Reschedule audit target does not match.");
    }
    await repositories.activityEvents.append(audit);
    return {
      previousViewing,
      replacementViewing: persistedReplacement,
      manualExternalCleanupRequired: current.calendarReference !== null
    };
  });
}
