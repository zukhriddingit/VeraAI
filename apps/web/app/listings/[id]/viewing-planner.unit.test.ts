import { describe, expect, it } from "vitest";

import {
  approvalIntent,
  formatViewingCheckedAt,
  formatViewingWindow,
  interpretCreateHoldResponse,
  presentViewingPlanner
} from "./viewing-planner-view.ts";
import {
  allBlockedFixture,
  approvalFixture,
  checkedFixture,
  confirmationRequiredFixture,
  conflictFixture,
  createdFixture,
  errorFixture,
  fallbackFixture,
  internalUpdateFixture,
  loadingFixture
} from "./viewing-planner.test-fixtures.ts";

describe("presentViewingPlanner", () => {
  it("labels a successful check as primary-Calendar-only", () => {
    const view = presentViewingPlanner(checkedFixture());

    expect(view.availabilityHeading).toBe("Checked against your primary Google Calendar");
    expect(view.recoveryAction).toBeNull();
    expect(view.recoveryActions).toEqual([]);
    expect(view.windows).toHaveLength(1);
    expect(view.windows[0]?.calendarsChecked).toEqual(["primary"]);
  });

  it("uses explicit simulated-calendar copy in demo mode", () => {
    const view = presentViewingPlanner(checkedFixture(), { demoMode: true });

    expect(view.availabilityHeading).toBe("Checked against the simulated primary Calendar fixture");
    expect(view.availabilityDetail).toContain("no Google account or API is being used");
    expect(view.liveRegionMessage).not.toContain("your primary Google Calendar");
  });

  it.each([
    ["scope_not_granted", "connect", "Connect Calendar"],
    ["google_disconnected", "reconnect", "Reconnect Calendar"],
    ["google_temporarily_unavailable", "retry", "Retry Calendar check"],
    ["stale", "retry", "Retry Calendar check"],
    ["vera_rules_only", null, null]
  ] as const)("never labels %s windows conflict-free", (state, expectedAction, expectedLabel) => {
    const view = presentViewingPlanner(fallbackFixture(state));

    expect(view.availabilityHeading).toBe("Calendar conflicts not checked");
    expect(view.availabilityHeading).not.toContain("Checked against");
    expect(view.recoveryAction).toBe(expectedAction);
    expect(view.recoveryOptions[0] ?? null).toEqual(
      expectedAction === null
        ? null
        : {
            action: expectedAction,
            label: expectedLabel
          }
    );
    expect(view.windows.every((window) => window.requiresConflictWarning)).toBe(true);
    expect(view.liveRegionMessage).toContain("Calendar conflicts not checked");
  });

  it("offers availability editing when every candidate is blocked", () => {
    const view = presentViewingPlanner(allBlockedFixture());

    expect(view.availabilityHeading).toBe("Checked against your primary Google Calendar");
    expect(view.availabilityDetail).toContain("No viewing windows remain");
    expect(view.recoveryAction).toBe("edit_availability");
    expect(view.windows).toEqual([]);
  });

  it("shows the exact side effect next to approval", () => {
    const view = presentViewingPlanner(approvalFixture());

    expect(view.availabilityHeading).toBe("Review private tentative hold");
    expect(view.availabilityHeading).not.toContain("Checked against");
    expect(view.availabilityDetail).toBe(
      "Final Calendar conflict check runs after approval, immediately before creation."
    );
    expect(view.preview?.title).toBe("Tentative viewing — 12 Cedar St");
    expect(view.previewDetails).toEqual({
      title: "Tentative viewing — 12 Cedar St",
      time: "Tuesday, July 28, 6:00–6:45 PM",
      timeZone: "America/New_York",
      address: "12 Cedar St, Boston, MA 02130",
      notes: "Ask whether the building entrance is on Cedar Street.\nVERA-HOLD:calendar-hold-1",
      reminders: "60 minutes and 10 minutes before",
      notifications: "None"
    });
    expect(view.sideEffectDisclosure).toBe("No landlord will be invited or notified");
    expect(view.preview?.notifications).toBe("none");
  });

  it("announces loading without presenting a completed result", () => {
    const view = presentViewingPlanner(loadingFixture());

    expect(view.liveRegionMessage).toBe(
      "Checking viewing availability against your rules and permitted Calendar data."
    );
    expect(view.liveRegionRole).toBe("status");
    expect(view.ariaLive).toBe("polite");
    expect(view.windows).toEqual([]);
  });

  it("offers checked replacement windows when a final conflict appears", () => {
    const view = presentViewingPlanner(conflictFixture());

    expect(view.availabilityHeading).toBe("Selected time is no longer available");
    expect(view.recoveryAction).toBe("choose_replacement");
    expect(view.replacementViewingId).toBe("viewing-replacement-1");
    expect(view.windows).toHaveLength(2);
    expect(view.liveRegionRole).toBe("alert");
    expect(view.ariaLive).toBe("assertive");
  });

  it("falls back to editing availability when no replacement survives", () => {
    const view = presentViewingPlanner(conflictFixture(false));

    expect(view.recoveryAction).toBe("edit_availability");
    expect(view.availabilityDetail).toContain("No replacement window is currently available");
  });

  it("requires explicit warned approval after a failed final check", () => {
    const view = presentViewingPlanner(confirmationRequiredFixture());

    expect(view.availabilityHeading).toBe("Calendar conflicts not checked");
    expect(view.recoveryAction).toBe("continue_with_warning");
    expect(view.preview?.conflictCheckOverride).toBe(true);
    expect(view.preview?.warning).toContain("could not be rechecked");
    expect(view.liveRegionRole).toBe("alert");
  });

  it("distinguishes a newly created hold from idempotent duplicate success", () => {
    const created = presentViewingPlanner(createdFixture());
    const duplicate = presentViewingPlanner(createdFixture(true));

    expect(created.liveRegionMessage).toBe(
      "Tentative hold created—no landlord was invited or notified"
    );
    expect(duplicate.liveRegionMessage).toBe(
      "Tentative hold already existed—no duplicate event was created"
    );
    expect(created.sideEffectDisclosure).toBe("No landlord will be invited or notified");
  });

  it.each(["cancelled", "rescheduled"] as const)(
    "warns that an internally %s viewing may need external cleanup",
    (operation) => {
      const view = presentViewingPlanner(internalUpdateFixture(operation));

      expect(view.externalCleanupWarning).toBe(
        "The Google Calendar hold may still exist; remove it manually."
      );
      expect(view.availabilityDetail).toContain("Vera only");
      expect(view.liveRegionRole).toBe("alert");
    }
  );

  it("uses assertive alert semantics for a recoverable error", () => {
    const view = presentViewingPlanner(errorFixture());

    expect(view.recoveryAction).toBe("retry");
    expect(view.liveRegionMessage).toBe("Google Calendar could not be checked right now.");
    expect(view.liveRegionRole).toBe("alert");
    expect(view.ariaLive).toBe("assertive");
    expect(view.regionLabel).toBe("Viewing planner");
    expect(view.windowGroupLabel).toBe("Proposed viewing windows");
  });

  it("formats the date and time in the persisted viewing timezone", () => {
    const fixture = checkedFixture();
    if (fixture.kind !== "proposals") throw new Error("Expected proposal fixture.");
    const window = fixture.result.windows[0];
    if (window === undefined) throw new Error("Expected proposal window.");

    expect(
      formatViewingWindow({
        ...window,
        startsAt: "2026-07-22T02:00:00.000Z",
        endsAt: "2026-07-22T02:45:00.000Z",
        timeZone: "America/New_York"
      }).date
    ).toBe("Tue, Jul 21");
    expect(
      formatViewingCheckedAt(
        {
          ...window,
          checkedAt: "2026-07-22T02:00:00.000Z",
          timeZone: "America/New_York"
        },
        false
      )
    ).toContain("Jul 21, 10:00 PM EDT");
  });

  it("requests write scope only on the explicit hosted creation intent", () => {
    expect(approvalIntent("missing", false)).toBe("calendar_hold_creation");
    expect(approvalIntent("granted", false)).toBe("approve");
    expect(approvalIntent("disconnected", true)).toBe("approve");
  });

  it("preserves a typed conflict result carried by HTTP 409", () => {
    const fixture = conflictFixture();
    if (fixture.kind !== "conflict_detected") throw new Error("Expected conflict fixture.");

    const interpretation = interpretCreateHoldResponse(409, {
      kind: "conflict_detected",
      replacementViewingId: fixture.replacementViewingId,
      replacementWindows: fixture.windows,
      recovery: {
        action: "choose_replacement",
        message: "A new conflict appeared. Choose a newly checked replacement window.",
        authorizationCapability: null
      }
    });

    expect(interpretation.kind).toBe("result");
    if (interpretation.kind === "result") {
      expect(interpretation.result.kind).toBe("conflict_detected");
    }
    expect(interpretCreateHoldResponse(409, { kind: "created" })).toEqual({
      kind: "invalid"
    });
  });
});
