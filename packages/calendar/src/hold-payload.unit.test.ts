import { describe, expect, it } from "vitest";

import { generateViewingWindows } from "./availability.ts";
import { mondayRule } from "./availability.test-fixtures.ts";
import {
  buildCalendarHoldEffectPayload,
  buildInsertTentativeHoldRequest,
  computeCalendarPayloadHash,
  computeGoogleEventId,
  type HoldPayloadInput
} from "./hold-payload.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function holdInput(overrides: Partial<HoldPayloadInput> = {}): HoldPayloadInput {
  const selectedWindow = generateViewingWindows({
    now: "2026-07-21T12:00:00.000Z",
    rules: mondayRule(),
    horizonDays: 14,
    availability: {
      state: "checked",
      checkId: "availability-check-hold",
      checkedAt: "2026-07-21T12:00:00.000Z",
      calendarIds: ["primary"],
      busy: []
    }
  })[0];
  if (selectedWindow === undefined) throw new Error("Expected a fixture window.");

  return {
    holdId: "calendar-hold-1",
    userId: USER_ID,
    viewingId: "viewing-1",
    shortAddress: "12 Cedar St",
    normalizedAddress: "12 Cedar St, Boston, MA 02108",
    canonicalListingUrl: "https://listings.example.test/cedar-12",
    sourceUrls: [
      "https://source-one.example.test/listing/12",
      "http://source-two.example.test/listing/alpha"
    ],
    contactNotes: "Ask whether the recurring utility fee is required.",
    selectedWindow,
    remindersMinutesBeforeStart: [30, 10],
    finalCheckState: "checked",
    conflictCheckOverride: false,
    conflictWarning: null,
    ...overrides
  };
}

function effectAndHash(input = holdInput()) {
  const effect = buildCalendarHoldEffectPayload(input);
  return { effect, hash: computeCalendarPayloadHash(effect) };
}

describe("Calendar hold effect payload", () => {
  it("builds the exact approved effect from a stable reserved hold ID", () => {
    const { effect } = effectAndHash();

    expect(effect).toEqual({
      holdId: "calendar-hold-1",
      viewingId: "viewing-1",
      veraMarker: "VERA-HOLD:calendar-hold-1",
      title: "Tentative viewing — 12 Cedar St",
      normalizedAddress: "12 Cedar St, Boston, MA 02108",
      description: [
        "Listing: https://listings.example.test/cedar-12",
        "Source: https://source-one.example.test/listing/12",
        "Source: http://source-two.example.test/listing/alpha",
        "Contact notes:",
        "Ask whether the recurring utility fee is required.",
        "VERA-HOLD:calendar-hold-1"
      ].join("\n"),
      startsAt: "2026-07-27T13:00:00Z",
      endsAt: "2026-07-27T14:00:00Z",
      timeZone: "America/New_York",
      remindersMinutesBeforeStart: [30, 10],
      calendarId: "primary",
      attendeeCount: 0,
      conferencing: false,
      notifications: "none",
      status: "tentative",
      visibility: "private",
      transparency: "opaque",
      finalCheckState: "checked",
      conflictCheckOverride: false,
      warning: null
    });
    expect(effect).not.toHaveProperty("eventId");
  });

  it("canonicalizes object keys while preserving approved array order", () => {
    const { effect, hash } = effectAndHash();
    const reversedKeyOrder = Object.fromEntries(Object.entries(effect).reverse());
    expect(computeCalendarPayloadHash(reversedKeyOrder as typeof effect)).toBe(hash);

    const reorderedSources = effectAndHash(
      holdInput({ sourceUrls: [...holdInput().sourceUrls].reverse() })
    );
    expect(reorderedSources.hash).not.toBe(hash);
  });

  it.each([
    ["address", { normalizedAddress: "14 Cedar St, Boston, MA 02108" }],
    ["notes", { contactNotes: "Confirm water and heat fees." }],
    ["reminders", { remindersMinutesBeforeStart: [15] }],
    ["hold ID", { holdId: "calendar-hold-2" }],
    [
      "warning override",
      {
        finalCheckState: "google_temporarily_unavailable",
        conflictCheckOverride: true,
        conflictWarning: "Google Calendar could not be checked."
      }
    ]
  ] as const)("changes the approval hash when the approved %s changes", (_label, change) => {
    const baseline = effectAndHash().hash;
    const changed = effectAndHash(holdInput(change as Partial<HoldPayloadInput>)).hash;
    expect(changed).not.toBe(baseline);
  });

  it("requires an explicit warning override unless the final check succeeded", () => {
    expect(() =>
      buildCalendarHoldEffectPayload(
        holdInput({
          finalCheckState: "google_temporarily_unavailable",
          conflictCheckOverride: false,
          conflictWarning: null
        })
      )
    ).toThrow(/explicit visible warning/u);
    expect(() =>
      buildCalendarHoldEffectPayload(
        holdInput({
          finalCheckState: "checked",
          conflictCheckOverride: true,
          conflictWarning: "Ignore the check."
        })
      )
    ).toThrow(/cannot carry an override/u);
  });

  it.each([
    "ftp://listings.example.test/12",
    "https://user:secret@listings.example.test/12",
    "https://listings.example.test/12#contact",
    " https://listings.example.test/12"
  ])("rejects unsafe approved source URL %s", (unsafeUrl) => {
    expect(() =>
      buildCalendarHoldEffectPayload(holdInput({ canonicalListingUrl: unsafeUrl }))
    ).toThrow(/URL/u);
  });
});

describe("Calendar hold deterministic identity", () => {
  it("hashes the effect without a derived event ID and derives exact Google identity", () => {
    const { effect, hash } = effectAndHash();
    const eventId = computeGoogleEventId({
      userId: USER_ID,
      viewingId: "viewing-1",
      startsAt: effect.startsAt,
      endsAt: effect.endsAt,
      payloadHash: hash
    });

    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(eventId).toMatch(/^vera[a-f0-9]{40}$/u);
    expect(
      computeGoogleEventId({
        userId: USER_ID,
        viewingId: "viewing-1",
        startsAt: effect.startsAt,
        endsAt: effect.endsAt,
        payloadHash: hash
      })
    ).toBe(eventId);
    expect(hash).toBe(computeCalendarPayloadHash(effect));
  });

  it("changes identity when tenant, viewing, interval, or effect hash changes", () => {
    const { effect, hash } = effectAndHash();
    const base = {
      userId: USER_ID,
      viewingId: "viewing-1",
      startsAt: effect.startsAt,
      endsAt: effect.endsAt,
      payloadHash: hash
    } as const;
    const baseline = computeGoogleEventId(base);

    expect(
      new Set([
        baseline,
        computeGoogleEventId({
          ...base,
          userId: "22222222-2222-4222-8222-222222222222"
        }),
        computeGoogleEventId({ ...base, viewingId: "viewing-2" }),
        computeGoogleEventId({ ...base, startsAt: "2026-07-27T13:15:00.000Z" }),
        computeGoogleEventId({ ...base, payloadHash: "f".repeat(64) })
      ]).size
    ).toBe(5);
  });

  it("canonicalizes equivalent instant spellings before deriving provider identity", () => {
    const { effect, hash } = effectAndHash();
    const canonical = computeGoogleEventId({
      userId: USER_ID,
      viewingId: "viewing-1",
      startsAt: effect.startsAt,
      endsAt: effect.endsAt,
      payloadHash: hash
    });
    const equivalentOffsets = computeGoogleEventId({
      userId: USER_ID,
      viewingId: "viewing-1",
      startsAt: "2026-07-27T09:00:00.000-04:00",
      endsAt: "2026-07-27T10:00:00.000-04:00",
      payloadHash: hash
    });

    expect(equivalentOffsets).toBe(canonical);
  });

  it("constructs the closed provider request only after event identity is derived", () => {
    const { effect, hash } = effectAndHash();
    const eventId = computeGoogleEventId({
      userId: USER_ID,
      viewingId: "viewing-1",
      startsAt: effect.startsAt,
      endsAt: effect.endsAt,
      payloadHash: hash
    });
    const request = buildInsertTentativeHoldRequest({ effect, eventId });

    expect(request).toMatchObject({
      calendarId: "primary",
      eventId,
      status: "tentative",
      visibility: "private",
      transparency: "opaque",
      attendees: [],
      conferenceData: null,
      sendUpdates: "none"
    });
    expect(request).not.toHaveProperty("finalCheckState");
    expect(request).not.toHaveProperty("conflictCheckOverride");
  });

  it("rejects an event ID embedded into the effect hash input", () => {
    const { effect } = effectAndHash();
    expect(() =>
      computeCalendarPayloadHash({
        ...effect,
        eventId: `vera${"0".repeat(40)}`
      } as typeof effect)
    ).toThrow();
  });
});
