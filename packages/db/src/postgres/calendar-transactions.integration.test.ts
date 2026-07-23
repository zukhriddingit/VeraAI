import type { ActivityEvent } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  approveCalendarHold,
  beginCalendarHoldCreation,
  cancelViewingInternally,
  failCalendarHoldCreation,
  finalizeCalendarHoldCreation,
  startViewingReschedule
} from "./calendar-transactions.ts";
import {
  CALENDAR_TEST_LATER,
  CALENDAR_TEST_NOW,
  CALENDAR_TEST_WINDOW,
  calendarHoldClaim,
  withSeededCalendarUser
} from "./calendar-testing.ts";

function audit(input: {
  readonly id: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payloadHash: string;
  readonly approvalId?: string | null;
  readonly outcome?: ActivityEvent["outcome"];
  readonly errorCategory?: ActivityEvent["errorCategory"];
  readonly metadata?: ActivityEvent["metadata"];
  readonly occurredAt?: string;
}): ActivityEvent {
  return {
    id: input.id,
    correlationId: `correlation-${input.id}`,
    causationId: null,
    actor: "system",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    policyDecision: "authorized",
    approvalId: input.approvalId ?? null,
    payloadHash: input.payloadHash,
    outcome: input.outcome ?? "succeeded",
    errorCategory: input.errorCategory ?? null,
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt ?? "2026-07-21T12:02:00.000Z"
  };
}

describe("atomic Calendar hold persistence services", () => {
  it("records the exact approval, hold, Viewing transition, and audit together", async () => {
    await withSeededCalendarUser(async ({ provider, userId, listing }) => {
      const repositories = provider.forUser(userId);
      const viewing = await repositories.viewings.insert({
        id: "viewing-calendar-approval-test",
        canonicalListingId: listing.id,
        proposedWindows: [CALENDAR_TEST_WINDOW],
        selectedWindow: CALENDAR_TEST_WINDOW,
        confirmedWindow: null,
        supersedesViewingId: null,
        timeZone: "America/New_York",
        calendarReference: null,
        state: "selected",
        notes: null,
        metadata: {},
        createdAt: CALENDAR_TEST_NOW,
        updatedAt: CALENDAR_TEST_NOW
      });
      const payloadHash = "9".repeat(64);
      const approval = {
        id: "approval-calendar-approval-test",
        actor: "user" as const,
        connectorId: "google-calendar",
        operation: "calendar.hold.create",
        targetType: "calendar_hold",
        targetId: "hold-calendar-approval-test",
        payloadHash,
        state: "pending" as const,
        createdAt: CALENDAR_TEST_NOW,
        expiresAt: "2026-07-21T12:10:00.000Z",
        usedAt: null
      };
      const hold = {
        id: approval.targetId,
        viewingId: viewing.id,
        approvalId: approval.id,
        availabilityCheckId: CALENDAR_TEST_WINDOW.availabilityCheckId,
        payloadHash,
        idempotencyKey: "8".repeat(64),
        googleEventId: `vera${"3".repeat(40)}`,
        providerEventReference: null,
        state: "approved" as const,
        conflictCheckOverride: false,
        conflictCheckOverrideReason: null,
        safeErrorCode: null,
        createdAt: CALENDAR_TEST_NOW,
        updatedAt: CALENDAR_TEST_NOW,
        completedAt: null
      };
      const event = audit({
        id: "event-calendar-hold-approved",
        action: "calendar.hold_approval_recorded",
        targetType: "calendar_hold",
        targetId: hold.id,
        approvalId: approval.id,
        payloadHash,
        metadata: { holdId: hold.id, viewingId: viewing.id },
        occurredAt: CALENDAR_TEST_LATER
      });
      await repositories.calendarHolds.insert({
        ...hold,
        approvalId: null,
        state: "approval_pending"
      });
      const result = await approveCalendarHold(provider, userId, {
        approval,
        hold,
        selectedWindow: CALENDAR_TEST_WINDOW,
        approvedAt: CALENDAR_TEST_LATER,
        activityEvent: event
      });
      expect(result).toMatchObject({
        approval: { state: "pending" },
        hold: { state: "approved" },
        viewing: { state: "hold_approved" }
      });
      await expect(repositories.activityEvents.getById(event.id)).resolves.toEqual(event);
    });
  });

  it("records a warned override approval without replaying the Viewing transition", async () => {
    await withSeededCalendarUser(async ({ provider, userId, viewing, hold }) => {
      const repositories = provider.forUser(userId);
      const payloadHash = "7".repeat(64);
      const approval = {
        id: "approval-calendar-override-test",
        actor: "user" as const,
        connectorId: "google-calendar",
        operation: "calendar.hold.create_without_conflict_check",
        targetType: "calendar_hold",
        targetId: "hold-calendar-override-test",
        payloadHash,
        state: "pending" as const,
        createdAt: CALENDAR_TEST_NOW,
        expiresAt: "2026-07-21T12:10:00.000Z",
        usedAt: null
      };
      const overrideHold = {
        ...hold,
        id: approval.targetId,
        approvalId: approval.id,
        payloadHash,
        idempotencyKey: "6".repeat(64),
        googleEventId: `vera${"4".repeat(40)}`,
        conflictCheckOverride: true,
        conflictCheckOverrideReason: "google_temporarily_unavailable" as const
      };
      await repositories.calendarHolds.insert({
        ...overrideHold,
        approvalId: null,
        state: "approval_pending"
      });
      const event = audit({
        id: "event-calendar-hold-override-approved",
        action: "calendar.hold_override_approved",
        targetType: "calendar_hold",
        targetId: overrideHold.id,
        approvalId: approval.id,
        payloadHash,
        occurredAt: CALENDAR_TEST_LATER
      });

      const result = await approveCalendarHold(provider, userId, {
        approval,
        hold: overrideHold,
        selectedWindow: CALENDAR_TEST_WINDOW,
        approvedAt: CALENDAR_TEST_LATER,
        activityEvent: event
      });

      expect(result).toMatchObject({
        hold: { state: "approved", conflictCheckOverride: true },
        viewing: { id: viewing.id, state: "hold_approved" }
      });
      await expect(repositories.activityEvents.getById(event.id)).resolves.toEqual(event);
    });
  });

  it("consumes one exact approval and claims one hold creation under concurrency", async () => {
    await withSeededCalendarUser(async ({ provider, userId, approval, hold }) => {
      const attempts = await Promise.allSettled([
        beginCalendarHoldCreation(provider, userId, calendarHoldClaim(approval, hold)),
        beginCalendarHoldCreation(provider, userId, calendarHoldClaim(approval, hold))
      ]);
      expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
      await expect(provider.forUser(userId).approvals.getById(approval.id)).resolves.toMatchObject({
        state: "used",
        usedAt: CALENDAR_TEST_LATER
      });
      await expect(provider.forUser(userId).calendarHolds.getById(hold.id)).resolves.toMatchObject({
        state: "creating"
      });
    });
  });

  it("rolls back approval consumption on payload mismatch", async () => {
    await withSeededCalendarUser(async ({ provider, userId, approval, hold }) => {
      await expect(
        beginCalendarHoldCreation(provider, userId, {
          ...calendarHoldClaim(approval, hold),
          payloadHash: "b".repeat(64)
        })
      ).rejects.toThrow("payload hash");
      await expect(provider.forUser(userId).approvals.getById(approval.id)).resolves.toMatchObject({
        state: "pending"
      });
      await expect(provider.forUser(userId).calendarHolds.getById(hold.id)).resolves.toMatchObject({
        state: "approved"
      });
    });
  });

  it("finalizes provider success with Viewing, listing, and safe audit atomically", async () => {
    await withSeededCalendarUser(async ({ provider, userId, approval, hold, viewing, listing }) => {
      await beginCalendarHoldCreation(provider, userId, calendarHoldClaim(approval, hold));
      const providerReference = "google-event-reference-opaque-1";
      const event = audit({
        id: "event-calendar-hold-created",
        action: "calendar.hold_created",
        targetType: "calendar_hold",
        targetId: hold.id,
        approvalId: approval.id,
        payloadHash: hold.payloadHash,
        metadata: { holdId: hold.id, viewingId: viewing.id, calendarId: "primary" }
      });
      const result = await finalizeCalendarHoldCreation(provider, userId, {
        holdId: hold.id,
        viewingId: viewing.id,
        providerEventReference: providerReference,
        finalizedAt: event.occurredAt,
        activityEvent: event
      });
      expect(result).toMatchObject({
        replayed: false,
        hold: { state: "created", providerEventReference: providerReference },
        viewing: { state: "hold_created", calendarReference: providerReference }
      });
      await expect(
        provider.forUser(userId).canonicalListings.getById(listing.id)
      ).resolves.toMatchObject({ lifecycleState: "tour_scheduled" });
      await expect(provider.forUser(userId).activityEvents.getById(event.id)).resolves.toEqual(
        event
      );
    });
  });

  it("records a retryable provider failure without raw provider data", async () => {
    await withSeededCalendarUser(async ({ provider, userId, approval, hold }) => {
      await beginCalendarHoldCreation(provider, userId, calendarHoldClaim(approval, hold));
      const event = audit({
        id: "event-calendar-hold-failed",
        action: "calendar.hold_creation_failed",
        targetType: "calendar_hold",
        targetId: hold.id,
        approvalId: approval.id,
        payloadHash: hold.payloadHash,
        outcome: "failed",
        errorCategory: "transient_provider",
        metadata: { retryable: true, safeErrorCode: "provider_timeout" }
      });
      await expect(
        failCalendarHoldCreation(provider, userId, {
          holdId: hold.id,
          retryable: true,
          safeErrorCode: "provider_timeout",
          errorCategory: "transient_provider",
          failedAt: event.occurredAt,
          activityEvent: event
        })
      ).resolves.toMatchObject({
        state: "retryable_failed",
        safeErrorCode: "provider_timeout",
        completedAt: null
      });
      const persistedEvent = await provider.forUser(userId).activityEvents.getById(event.id);
      expect(persistedEvent?.metadata).toEqual({
        retryable: true,
        safeErrorCode: "provider_timeout"
      });
    });
  });

  it("rolls back internal cancellation when its audit event cannot persist", async () => {
    await withSeededCalendarUser(async ({ provider, userId, viewing }) => {
      const event = audit({
        id: "event-calendar-cancel-rollback",
        action: "viewing.cancelled_internal",
        targetType: "viewing",
        targetId: viewing.id,
        approvalId: "missing-approval",
        payloadHash: "a".repeat(64)
      });
      await expect(
        cancelViewingInternally(provider, userId, {
          viewingId: viewing.id,
          cancelledAt: event.occurredAt,
          activityEvent: event
        })
      ).rejects.toMatchObject({ category: "ownership_violation" });
      await expect(provider.forUser(userId).viewings.getById(viewing.id)).resolves.toMatchObject({
        state: "hold_approved"
      });
    });
  });

  it("starts rescheduling with explicit lineage and cancels the internal hold only", async () => {
    await withSeededCalendarUser(async ({ provider, userId, viewing, hold }) => {
      const startedAt = "2026-07-21T12:03:00.000Z";
      const replacement = {
        id: "viewing-calendar-replacement-1",
        canonicalListingId: viewing.canonicalListingId,
        proposedWindows: [CALENDAR_TEST_WINDOW],
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: viewing.id,
        timeZone: "America/New_York",
        calendarReference: null,
        state: "proposed" as const,
        notes: null,
        metadata: {},
        createdAt: startedAt,
        updatedAt: startedAt
      };
      const event = audit({
        id: "event-calendar-reschedule",
        action: "viewing.reschedule_started",
        targetType: "viewing",
        targetId: replacement.id,
        payloadHash: "b".repeat(64),
        metadata: { viewingId: replacement.id },
        occurredAt: startedAt
      });
      const result = await startViewingReschedule(provider, userId, {
        currentViewingId: viewing.id,
        replacementViewing: replacement,
        startedAt,
        activityEvent: event
      });
      expect(result).toMatchObject({
        previousViewing: { state: "cancelled" },
        replacementViewing: {
          state: "proposed",
          supersedesViewingId: viewing.id
        },
        manualExternalCleanupRequired: false
      });
      await expect(
        provider.forUser(userId).viewings.listByCanonicalListingId(viewing.canonicalListingId)
      ).resolves.toHaveLength(2);
      await expect(provider.forUser(userId).calendarHolds.getById(hold.id)).resolves.toMatchObject({
        state: "cancelled_internal",
        completedAt: startedAt,
        providerEventReference: null
      });
    });
  });

  it("does not accept a selected-window substitution", async () => {
    await withSeededCalendarUser(async ({ provider, userId, approval, hold }) => {
      await expect(
        beginCalendarHoldCreation(provider, userId, {
          ...calendarHoldClaim(approval, hold),
          selectedWindow: {
            ...CALENDAR_TEST_WINDOW,
            endsAt: "2026-07-27T15:30:00.000Z"
          }
        })
      ).rejects.toThrow("selected Viewing window");
      expect((await provider.forUser(userId).approvals.getById(approval.id))?.state).toBe(
        "pending"
      );
    });
  });

  it("keeps fixture timestamps deterministic", () => {
    expect(Date.parse(CALENDAR_TEST_LATER)).toBeGreaterThan(Date.parse(CALENDAR_TEST_NOW));
  });
});
