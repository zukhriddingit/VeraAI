import { describe, expect, it } from "vitest";

import {
  ALLOWED_APPROVAL_TRANSITIONS,
  ALLOWED_VIEWING_TRANSITIONS,
  ApprovalStateSchema,
  InvalidApprovalTransitionError,
  InvalidViewingTransitionError,
  ViewingSchema,
  ViewingStateSchema,
  transitionApprovalState,
  transitionViewingState,
  type ApprovalState,
  type ViewingState
} from "./index.ts";

const createdAt = "2026-07-21T12:00:00.000Z";
const selectedWindow = {
  startsAt: "2026-07-27T13:00:00.000Z",
  endsAt: "2026-07-27T14:00:00.000Z",
  timeZone: "America/New_York",
  availabilitySource: "vera_rules_only",
  state: "scope_not_granted",
  availabilityCheckId: "availability-check-1",
  checkedAt: null,
  calendarsChecked: [],
  requiresConflictWarning: true,
  rules: {
    timeZone: "America/New_York",
    weeklyIntervals: {
      "1": [{ startsAt: "09:00", endsAt: "12:00" }],
      "2": [],
      "3": [],
      "4": [],
      "5": [],
      "6": [],
      "7": []
    },
    durationMinutes: 60,
    minimumNoticeMinutes: 120,
    travelMinutes: 20,
    bufferMinutes: 10,
    remindersMinutesBeforeStart: [30],
    conflictCheckingEnabled: true,
    calendarIds: ["primary"],
    schemaVersion: 1
  },
  generatorVersion: "availability.v1"
} as const;

describe("approval state transitions", () => {
  it("allows every declared transition", () => {
    for (const current of ApprovalStateSchema.options) {
      const nextStates: readonly ApprovalState[] = ALLOWED_APPROVAL_TRANSITIONS[current];
      for (const requested of nextStates) {
        expect(transitionApprovalState(current, requested)).toBe(requested);
      }
    }
  });

  it("prevents reuse or resurrection of terminal approvals", () => {
    for (const terminal of ["used", "expired", "revoked"] as const) {
      expect(ALLOWED_APPROVAL_TRANSITIONS[terminal]).toHaveLength(0);
      expect(() => transitionApprovalState(terminal, "used")).toThrow(
        InvalidApprovalTransitionError
      );
    }
  });

  it("reports the current and requested states safely", () => {
    try {
      transitionApprovalState("revoked", "used");
      throw new Error("Expected approval transition failure.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidApprovalTransitionError);
      if (!(error instanceof InvalidApprovalTransitionError)) throw error;
      expect(error.current).toBe("revoked");
      expect(error.requested).toBe("used");
    }
  });
});

describe("viewing state transitions", () => {
  it("allows every declared transition", () => {
    for (const current of ViewingStateSchema.options) {
      const nextStates: readonly ViewingState[] = ALLOWED_VIEWING_TRANSITIONS[current];
      for (const requested of nextStates) {
        expect(transitionViewingState(current, requested)).toBe(requested);
      }
    }
  });

  it("rejects skipped creation and terminal transitions", () => {
    expect(transitionViewingState("proposed", "selected")).toBe("selected");
    expect(transitionViewingState("selected", "hold_approved")).toBe("hold_approved");
    expect(() => transitionViewingState("proposed", "hold_created")).toThrow(
      InvalidViewingTransitionError
    );
    expect(() => transitionViewingState("completed", "cancelled")).toThrow(
      InvalidViewingTransitionError
    );
  });

  it("requires selected and confirmed fields to match the persisted state", () => {
    const proposed = {
      id: "viewing-1",
      canonicalListingId: "listing-1",
      proposedWindows: [selectedWindow],
      selectedWindow: null,
      confirmedWindow: null,
      supersedesViewingId: null,
      timeZone: "America/New_York",
      calendarReference: null,
      state: "proposed",
      notes: null,
      metadata: {},
      createdAt,
      updatedAt: createdAt
    } as const;
    expect(ViewingSchema.parse(proposed).state).toBe("proposed");
    expect(
      ViewingSchema.parse({ ...proposed, state: "selected", selectedWindow }).selectedWindow
    ).toEqual(selectedWindow);
    expect(() => ViewingSchema.parse({ ...proposed, state: "selected" })).toThrow(
      "selected window"
    );
    expect(() =>
      ViewingSchema.parse({
        ...proposed,
        state: "selected",
        selectedWindow: { ...selectedWindow, startsAt: "2026-07-27T14:00:00.000Z" }
      })
    ).toThrow("persisted proposed windows");
    expect(() =>
      ViewingSchema.parse({
        ...proposed,
        state: "selected",
        selectedWindow: {
          ...selectedWindow,
          state: "google_disconnected",
          availabilityCheckId: "availability-check-2"
        }
      })
    ).toThrow("persisted proposed windows");
  });

  it("rejects duplicate proposed intervals even when their provenance differs", () => {
    expect(() =>
      ViewingSchema.parse({
        id: "viewing-duplicates",
        canonicalListingId: "listing-1",
        proposedWindows: [
          selectedWindow,
          {
            ...selectedWindow,
            state: "google_disconnected",
            availabilityCheckId: "availability-check-2"
          }
        ],
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: null,
        timeZone: "America/New_York",
        calendarReference: null,
        state: "proposed",
        notes: null,
        metadata: {},
        createdAt,
        updatedAt: createdAt
      })
    ).toThrow("intervals must be unique");
  });

  it("requires one preserved IANA timezone across the Viewing and every proposal", () => {
    expect(() =>
      ViewingSchema.parse({
        id: "viewing-wrong-zone",
        canonicalListingId: "listing-1",
        proposedWindows: [selectedWindow],
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: null,
        timeZone: "US/Eastern",
        calendarReference: null,
        state: "proposed",
        notes: null,
        metadata: {},
        createdAt,
        updatedAt: createdAt
      })
    ).toThrow("Viewing timezone");
    expect(() =>
      ViewingSchema.parse({
        id: "viewing-padded-zone",
        canonicalListingId: "listing-1",
        proposedWindows: [],
        selectedWindow: null,
        confirmedWindow: null,
        supersedesViewingId: null,
        timeZone: " America/New_York ",
        calendarReference: null,
        state: "proposed",
        notes: null,
        metadata: {},
        createdAt,
        updatedAt: createdAt
      })
    ).toThrow("IANA");
  });

  it("preserves an external reference when an internally cancelled viewing needs cleanup", () => {
    const cancelled = ViewingSchema.parse({
      id: "viewing-cancelled",
      canonicalListingId: "listing-1",
      proposedWindows: [selectedWindow],
      selectedWindow,
      confirmedWindow: null,
      supersedesViewingId: null,
      timeZone: "America/New_York",
      calendarReference: "opaque-event-reference",
      state: "cancelled",
      notes: null,
      metadata: {},
      createdAt,
      updatedAt: "2026-07-21T12:05:00.000Z"
    });
    expect(cancelled.calendarReference).toBe("opaque-event-reference");
  });
});
