import { SourcePolicyRegistry } from "@vera/policy";
import { SOURCE_POLICY_MANIFEST_FIXTURES } from "@vera/db/demo";
import { afterEach, describe, expect, it } from "vitest";

import { createCalendarHoldService } from "./calendar-hold-service.ts";
import {
  approveNormalPreview,
  HOLD_TEST_NOW,
  holdServiceFixture,
  initiallyFree,
  nowBusy,
  temporarilyUnavailable,
  type CalendarHoldServiceFixture
} from "./calendar-hold-service.test-fixtures.ts";

const fixtures: CalendarHoldServiceFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

describe("CalendarHoldService orchestration", () => {
  it("creates one private tentative hold and returns an idempotent replay", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    const { prepared, approved } = await approveNormalPreview(fixture);
    const request = {
      viewingId: fixture.viewingId,
      approvalId: approved.approval.id,
      expectedPayloadHash: prepared.preview.payloadHash,
      conflictCheckOverride: false,
      correlationId: "correlation-create-hold"
    } as const;

    await expect(fixture.service.createApprovedHold(request)).resolves.toMatchObject({
      kind: "created",
      duplicate: false,
      hold: { state: "created" }
    });
    await expect(fixture.service.createApprovedHold(request)).resolves.toMatchObject({
      kind: "created",
      duplicate: true,
      hold: { state: "created" }
    });
    expect(fixture.client.insertCalls).toHaveLength(1);
    expect(fixture.client.insertCalls[0]).toMatchObject({
      attendees: [],
      conferenceData: null,
      sendUpdates: "none",
      status: "tentative",
      visibility: "private"
    });
    await expect(fixture.repositories.viewings.getById(fixture.viewingId)).resolves.toMatchObject({
      state: "hold_created"
    });
    await expect(
      fixture.repositories.canonicalListings.getById(fixture.listingId)
    ).resolves.toMatchObject({ lifecycleState: "tour_scheduled" });
  });

  it("revokes approval, cancels the old Viewing, and persists replacements for a new conflict", async () => {
    const fixture = await holdServiceFixture([nowBusy]);
    fixtures.push(fixture);
    const { prepared, approved } = await approveNormalPreview(fixture);
    const result = await fixture.service.createApprovedHold({
      viewingId: fixture.viewingId,
      approvalId: approved.approval.id,
      expectedPayloadHash: prepared.preview.payloadHash,
      conflictCheckOverride: false,
      correlationId: "correlation-final-conflict"
    });

    expect(result).toMatchObject({ kind: "conflict_detected" });
    if (result.kind !== "conflict_detected") throw new Error("Expected conflict response.");
    expect(result.replacementWindows).toHaveLength(3);
    expect(fixture.client.insertCalls).toHaveLength(0);
    await expect(
      fixture.repositories.approvals.getById(approved.approval.id)
    ).resolves.toMatchObject({ state: "revoked" });
    await expect(fixture.repositories.viewings.getById(fixture.viewingId)).resolves.toMatchObject({
      state: "cancelled"
    });
    await expect(
      fixture.repositories.viewings.getById(result.replacementViewingId)
    ).resolves.toMatchObject({
      state: "proposed",
      supersedesViewingId: fixture.viewingId,
      proposedWindows: result.replacementWindows
    });
    await expect(
      fixture.service.createOverridePreview({
        viewingId: fixture.viewingId,
        holdId: prepared.hold.id,
        expectedPayloadHash: prepared.preview.payloadHash
      })
    ).rejects.toMatchObject({ code: "approval_payload_mismatch" });
  });

  it("requires a new override approval after a failed final check", async () => {
    const fixture = await holdServiceFixture([temporarilyUnavailable]);
    fixtures.push(fixture);
    const { prepared, approved } = await approveNormalPreview(fixture);
    const first = await fixture.service.createApprovedHold({
      viewingId: fixture.viewingId,
      approvalId: approved.approval.id,
      expectedPayloadHash: prepared.preview.payloadHash,
      conflictCheckOverride: false,
      correlationId: "correlation-final-unavailable"
    });
    expect(first.kind).toBe("confirmation_required");
    if (first.kind !== "confirmation_required") throw new Error("Expected warned override.");

    await expect(
      fixture.service.createApprovedHold({
        viewingId: fixture.viewingId,
        approvalId: approved.approval.id,
        expectedPayloadHash: prepared.preview.payloadHash,
        conflictCheckOverride: true,
        correlationId: "correlation-invalid-reuse"
      })
    ).rejects.toMatchObject({ code: "approval_payload_mismatch" });

    const overrideHold = await fixture.repositories.calendarHolds.getById(
      first.overridePreview.holdId
    );
    expect(overrideHold).toMatchObject({ state: "approval_pending", conflictCheckOverride: true });
    const overrideApproval = await fixture.service.approvePreview({
      viewingId: fixture.viewingId,
      holdId: first.overridePreview.holdId,
      expectedPayloadHash: first.overridePreview.payloadHash,
      correlationId: "correlation-override-approval"
    });
    await expect(
      fixture.service.createApprovedHold({
        viewingId: fixture.viewingId,
        approvalId: overrideApproval.approval.id,
        expectedPayloadHash: first.overridePreview.payloadHash,
        conflictCheckOverride: true,
        correlationId: "correlation-override-create"
      })
    ).resolves.toMatchObject({ kind: "created", hold: { state: "created" } });
  });

  it("audits and cancels the reservation when the persisted policy is disabled", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    const { prepared, approved } = await approveNormalPreview(fixture);
    const calendarManifest = SOURCE_POLICY_MANIFEST_FIXTURES.find(
      ({ connectorId }) => connectorId === "google.calendar.v1"
    );
    if (calendarManifest === undefined) throw new Error("Expected Calendar policy fixture.");
    const deniedService = createCalendarHoldService({
      userId: "018f9f64-7b5a-7c91-a12e-000000000001",
      repositories: fixture.repositories,
      repositoryProvider: fixture.repositoryProvider,
      calendar: fixture.calendar,
      clock: () => HOLD_TEST_NOW,
      policyRegistryFactory: async () =>
        new SourcePolicyRegistry([{ ...calendarManifest, enabled: false }])
    });
    await expect(
      deniedService.createApprovedHold({
        viewingId: fixture.viewingId,
        approvalId: approved.approval.id,
        expectedPayloadHash: prepared.preview.payloadHash,
        conflictCheckOverride: false,
        correlationId: "correlation-policy-denied"
      })
    ).rejects.toMatchObject({ code: "policy_denied" });
    await expect(
      fixture.repositories.approvals.getById(approved.approval.id)
    ).resolves.toMatchObject({ state: "revoked" });
    await expect(
      fixture.repositories.calendarHolds.getById(prepared.hold.id)
    ).resolves.toMatchObject({ state: "cancelled_internal" });
    const audits = await fixture.repositories.activityEvents.listByTarget(
      "calendar_hold",
      prepared.hold.id
    );
    expect(audits).toContainEqual(
      expect.objectContaining({
        action: "calendar.hold_creation_failed",
        policyDecision: "denied",
        errorCategory: "policy_denial"
      })
    );
  });
});
