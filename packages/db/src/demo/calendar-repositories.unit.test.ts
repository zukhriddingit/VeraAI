import { describe, expect, it } from "vitest";

import {
  DEMO_AVAILABILITY_RULES,
  DemoCalendarConflictError,
  createDemoCalendarSidecar
} from "./calendar-repositories.ts";
import {
  DEMO_CALENDAR_TEST_LATER,
  demoAvailabilityCheck,
  demoCalendarHold
} from "./calendar-repositories.test-fixtures.ts";

describe("deterministic demo Calendar sidecar", () => {
  it("starts from safe weekly rules and resets with a new process-owned instance", async () => {
    const first = createDemoCalendarSidecar();
    await first.repositories.availabilityRuleSets.upsertCurrent({
      ...DEMO_AVAILABILITY_RULES,
      bufferMinutes: 40,
      updatedAt: DEMO_CALENDAR_TEST_LATER
    });
    await first.repositories.availabilityChecks.append(demoAvailabilityCheck);

    const reset = createDemoCalendarSidecar();
    await expect(reset.repositories.availabilityRuleSets.getCurrent()).resolves.toEqual(
      DEMO_AVAILABILITY_RULES
    );
    await expect(reset.repositories.availabilityChecks.listRecent(10)).resolves.toEqual([]);
  });

  it("keeps availability checks append-only", async () => {
    const sidecar = createDemoCalendarSidecar();
    await expect(
      sidecar.repositories.availabilityChecks.append(demoAvailabilityCheck)
    ).resolves.toEqual(demoAvailabilityCheck);
    await expect(
      sidecar.repositories.availabilityChecks.append(demoAvailabilityCheck)
    ).rejects.toThrow(DemoCalendarConflictError);
    await expect(
      sidecar.repositories.availabilityChecks.getById(demoAvailabilityCheck.id)
    ).resolves.toEqual(demoAvailabilityCheck);
  });

  it("makes hold insertion idempotent and rejects key collisions", async () => {
    const sidecar = createDemoCalendarSidecar();
    await sidecar.repositories.availabilityChecks.append(demoAvailabilityCheck);

    await expect(sidecar.repositories.calendarHolds.insert(demoCalendarHold)).resolves.toEqual(
      demoCalendarHold
    );
    await expect(
      sidecar.repositories.calendarHolds.listByViewingId(demoCalendarHold.viewingId)
    ).resolves.toEqual([demoCalendarHold]);
    await expect(sidecar.repositories.calendarHolds.insert(demoCalendarHold)).resolves.toEqual(
      demoCalendarHold
    );
    await expect(
      sidecar.repositories.calendarHolds.insert({
        ...demoCalendarHold,
        id: "demo-calendar-hold-collision",
        payloadHash: "e".repeat(64),
        googleEventId: `vera${"f".repeat(40)}`
      })
    ).rejects.toThrow("different immutable payload");
  });

  it("uses compare-and-set transitions and preserves terminal hold metadata", async () => {
    const sidecar = createDemoCalendarSidecar();
    await sidecar.repositories.availabilityChecks.append(demoAvailabilityCheck);
    await sidecar.repositories.calendarHolds.insert(demoCalendarHold);
    const approved = await sidecar.repositories.calendarHolds.transition(
      demoCalendarHold.id,
      "approval_pending",
      "approved",
      DEMO_CALENDAR_TEST_LATER,
      { approvalId: "demo-approval-1" }
    );
    expect(approved).toMatchObject({ state: "approved", approvalId: "demo-approval-1" });

    const attempts = await Promise.allSettled([
      sidecar.repositories.calendarHolds.transition(
        demoCalendarHold.id,
        "approved",
        "creating",
        "2026-07-21T12:02:00.000Z"
      ),
      sidecar.repositories.calendarHolds.transition(
        demoCalendarHold.id,
        "approved",
        "creating",
        "2026-07-21T12:02:00.000Z"
      )
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);

    await expect(
      sidecar.repositories.calendarHolds.transition(
        demoCalendarHold.id,
        "creating",
        "created",
        "2026-07-21T12:03:00.000Z",
        { providerEventReference: "demo-provider-event-1" }
      )
    ).resolves.toMatchObject({
      state: "created",
      providerEventReference: "demo-provider-event-1",
      completedAt: "2026-07-21T12:03:00.000Z"
    });
  });
});
