import { describe, expect, it } from "vitest";

import { ActivityEventSchema } from "@vera/domain";

import { projectActivityEvent } from "./listing-presentation.ts";

const calendarActivityDetails = {
  "viewing.availability_saved": "Viewing availability rules were saved.",
  "calendar.authorization_requested":
    "Google Calendar permission was requested for the selected capability.",
  "calendar.authorization_completed": "Google Calendar permission state was verified and updated.",
  "calendar.authorization_denied":
    "Google Calendar permission was denied, revoked, or unavailable.",
  "calendar.freebusy_checked":
    "The connected account's primary Google Calendar was checked using free/busy only.",
  "calendar.freebusy_unavailable":
    "Google Calendar free/busy was unavailable; Vera did not treat it as an empty calendar.",
  "viewing.proposals_created":
    "Viewing windows were proposed with their availability and Vera-rule provenance.",
  "viewing.window_selected": "A persisted proposed viewing window was selected.",
  "calendar.hold_approval_recorded":
    "Approval was recorded for the exact private tentative hold payload.",
  "calendar.hold_final_check_conflict":
    "A new conflict was found during the final check, so no hold was created.",
  "calendar.hold_final_check_unavailable":
    "The final Calendar check was unavailable; continuing requires a new warned approval.",
  "calendar.hold_override_approved":
    "The user explicitly approved creating the exact hold without a completed final conflict check.",
  "calendar.hold_created":
    "A private tentative hold was created without attendees, conferencing, or notifications.",
  "calendar.hold_creation_failed":
    "The approved tentative hold could not be created; no success was recorded.",
  "viewing.reschedule_started":
    "Rescheduling started in Vera only; an existing Google Calendar hold was not changed.",
  "viewing.cancelled_internal":
    "The viewing was cancelled in Vera only; an existing Google Calendar hold was not deleted.",
  "demo.viewing_fixture.prepared":
    "A sanitized simulated reply made this demo listing eligible for the offline viewing walkthrough."
} as const;

function calendarActivity(action: keyof typeof calendarActivityDetails) {
  return ActivityEventSchema.parse({
    id: `activity-${action.replaceAll(".", "-")}`,
    correlationId: "correlation-calendar-activity",
    causationId: null,
    actor: "vera",
    action,
    targetType: "viewing",
    targetId: "viewing-safe-1",
    policyDecision: "not_applicable",
    approvalId: null,
    payloadHash: "a".repeat(64),
    outcome: "succeeded",
    errorCategory: null,
    metadata: {
      address: "PRIVATE ADDRESS MUST NOT APPEAR",
      notes: "PRIVATE NOTES MUST NOT APPEAR",
      url: "https://private.example.test/listing",
      eventDescription: "PRIVATE EVENT DESCRIPTION MUST NOT APPEAR",
      providerBody: "PRIVATE PROVIDER BODY MUST NOT APPEAR"
    },
    occurredAt: "2026-07-21T15:00:00.000Z"
  });
}

describe("Calendar activity presentation", () => {
  it("projects every Calendar and viewing activity through static redacted copy", () => {
    for (const [action, expectedDetail] of Object.entries(calendarActivityDetails)) {
      const projection = projectActivityEvent(
        calendarActivity(action as keyof typeof calendarActivityDetails)
      );

      expect(projection.action).toBe(action);
      expect(projection.detail).toBe(expectedDetail);
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain("PRIVATE ADDRESS MUST NOT APPEAR");
      expect(serialized).not.toContain("PRIVATE NOTES MUST NOT APPEAR");
      expect(serialized).not.toContain("private.example.test");
      expect(serialized).not.toContain("PRIVATE EVENT DESCRIPTION MUST NOT APPEAR");
      expect(serialized).not.toContain("PRIVATE PROVIDER BODY MUST NOT APPEAR");
    }
  });

  it("returns no detail for an unknown action instead of exposing its metadata", () => {
    const event = ActivityEventSchema.parse({
      ...calendarActivity("calendar.freebusy_checked"),
      id: "activity-unknown",
      action: "calendar.unreviewed_provider_action"
    });
    const projection = projectActivityEvent(event);

    expect(projection.detail).toBeNull();
    expect(JSON.stringify(projection)).not.toContain("PRIVATE");
    expect(projection).not.toHaveProperty("metadata");
  });
});
