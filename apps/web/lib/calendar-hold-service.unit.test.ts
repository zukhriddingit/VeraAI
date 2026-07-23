import { afterEach, describe, expect, it } from "vitest";

import {
  createCalendarHoldService,
  type CalendarHoldServiceError
} from "./calendar-hold-service.ts";
import {
  approveNormalPreview,
  holdServiceFixture,
  initiallyFree,
  type CalendarHoldServiceFixture
} from "./calendar-hold-service.test-fixtures.ts";

const fixtures: CalendarHoldServiceFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

describe("CalendarHoldService exact state boundaries", () => {
  it("accepts only an exact persisted proposal interval", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    const current = await fixture.repositories.viewings.getById(fixture.viewingId);
    if (current?.selectedWindow === null || current?.selectedWindow === undefined) {
      throw new Error("Expected selected fixture window.");
    }
    await fixture.repositories.viewings.transition(
      current.id,
      "selected",
      "proposed",
      "2026-07-21T12:04:00.000Z"
    );

    await expect(
      fixture.service.selectWindow({
        viewingId: current.id,
        startsAt: current.selectedWindow.startsAt,
        endsAt: "2026-07-27T22:45:00.000Z",
        correlationId: "correlation-wrong-window"
      })
    ).rejects.toMatchObject({ code: "invalid_state_transition" });

    await expect(
      fixture.service.selectWindow({
        viewingId: current.id,
        startsAt: current.selectedWindow.startsAt,
        endsAt: current.selectedWindow.endsAt,
        correlationId: "correlation-exact-window"
      })
    ).resolves.toMatchObject({ viewing: { state: "selected" } });
  });

  it("rebuilds the payload and rejects a changed approval hash", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    const prepared = await fixture.service.createPreview({
      viewingId: fixture.viewingId,
      contactNotes: null,
      remindersMinutesBeforeStart: [30]
    });

    await expect(
      fixture.service.approvePreview({
        viewingId: fixture.viewingId,
        holdId: prepared.hold.id,
        expectedPayloadHash: "f".repeat(64),
        correlationId: "correlation-mismatched-preview"
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<CalendarHoldServiceError>>({
        code: "approval_payload_mismatch",
        httpStatus: 409
      })
    );
    await expect(
      fixture.repositories.calendarHolds.getById(prepared.hold.id)
    ).resolves.toMatchObject({ state: "approval_pending", approvalId: null });
  });

  it("expires an unused approval before any final check or provider write", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    const { prepared, approved } = await approveNormalPreview(fixture);
    const expiredService = createCalendarHoldService({
      userId: "018f9f64-7b5a-7c91-a12e-000000000001",
      repositories: fixture.repositories,
      repositoryProvider: fixture.repositoryProvider,
      calendar: fixture.calendar,
      clock: () => "2026-07-21T12:16:00.000Z"
    });

    await expect(
      expiredService.createApprovedHold({
        viewingId: fixture.viewingId,
        approvalId: approved.approval.id,
        expectedPayloadHash: prepared.preview.payloadHash,
        conflictCheckOverride: false,
        correlationId: "correlation-expired-approval"
      })
    ).rejects.toMatchObject({ code: "approval_expired" });
    await expect(
      fixture.repositories.approvals.getById(approved.approval.id)
    ).resolves.toMatchObject({ state: "expired" });
    expect(fixture.client.freeBusyCalls).toHaveLength(0);
    expect(fixture.client.insertCalls).toHaveLength(0);
  });
});
