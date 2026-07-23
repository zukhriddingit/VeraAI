import {
  ApproveCalendarHoldResponseSchema,
  CalendarApiErrorResponseSchema,
  CalendarHoldPreviewResponseSchema,
  CreateApprovedCalendarHoldResponseSchema,
  CreateViewingProposalsResponseSchema
} from "@vera/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  holdServiceFixture,
  initiallyFree,
  type CalendarHoldServiceFixture
} from "../../../../lib/calendar-hold-service.test-fixtures.ts";
import {
  clearApplicationForTesting,
  registerApplication,
  type VeraApplication
} from "../../../../lib/server/application-registry.ts";
import { POST as proposeViewing } from "../../listings/[id]/viewings/route.ts";
import { POST as createPreview, PUT as approvePreview } from "./approval/route.ts";
import { POST as createHold } from "./hold/route.ts";

const fixtures: CalendarHoldServiceFixture[] = [];

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function mutationRequest(path: string, body: unknown, origin = "http://127.0.0.1"): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function registerFixture(
  fixture: CalendarHoldServiceFixture,
  overrides: Partial<VeraApplication> = {}
): void {
  registerApplication({
    mode: "demo",
    repositoryProvider: fixture.repositoryProvider,
    auth: null,
    calendar: fixture.calendar,
    demoUserId: "018f9f64-7b5a-7c91-a12e-000000000001",
    readiness: vi.fn(),
    close: vi.fn(),
    ...overrides,
    gmailOAuth: overrides.gmailOAuth ?? null
  });
}

afterEach(() => {
  clearApplicationForTesting();
  for (const fixture of fixtures.splice(0)) fixture.close();
});

describe.sequential("Calendar viewing mutation routes", () => {
  it("persists strict viewing proposals and returns a no-store response", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    registerFixture(fixture);

    const response = await proposeViewing(
      mutationRequest(`/api/listings/${fixture.listingId}/viewings`, {}),
      context(fixture.listingId)
    );
    const result = CreateViewingProposalsResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(result.viewing.canonicalListingId).toBe(fixture.listingId);
    expect(result.viewing.proposedWindows).toEqual(result.windows);
    await expect(fixture.repositories.viewings.getById(result.viewing.id)).resolves.toEqual(
      result.viewing
    );
  });

  it("authenticates and checks origin before reading a bounded strict JSON body", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    registerFixture(fixture, { mode: "hosted", demoUserId: null });

    const unauthenticated = await createPreview(
      new Request(`http://127.0.0.1/api/viewings/${fixture.viewingId}/approval`, {
        method: "POST",
        body: "{not-json"
      }),
      context(fixture.viewingId)
    );
    expect(unauthenticated.status).toBe(401);
    expect(CalendarApiErrorResponseSchema.parse(await unauthenticated.json()).code).toBe(
      "unauthorized"
    );

    clearApplicationForTesting();
    registerFixture(fixture);
    const crossOrigin = await createPreview(
      mutationRequest(
        `/api/viewings/${fixture.viewingId}/approval`,
        "{not-json",
        "https://attacker.invalid"
      ),
      context(fixture.viewingId)
    );
    expect(crossOrigin.status).toBe(403);

    const malformed = await createPreview(
      mutationRequest(`/api/viewings/${fixture.viewingId}/approval`, "{not-json"),
      context(fixture.viewingId)
    );
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("cache-control")).toContain("no-store");

    const unsupportedMediaType = await createPreview(
      new Request(`http://127.0.0.1/api/viewings/${fixture.viewingId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: "http://127.0.0.1" },
        body: "{}"
      }),
      context(fixture.viewingId)
    );
    expect(unsupportedMediaType.status).toBe(415);

    const oversized = await createPreview(
      mutationRequest(`/api/viewings/${fixture.viewingId}/approval`, "x".repeat(16_385)),
      context(fixture.viewingId)
    );
    expect(oversized.status).toBe(413);
    expect(CalendarApiErrorResponseSchema.parse(await oversized.json()).code).toBe(
      "invalid_request"
    );
    await expect(
      fixture.repositories.calendarHolds.listByViewingId(fixture.viewingId)
    ).resolves.toEqual([]);
  });

  it("creates, approves, and idempotently inserts an exact private tentative hold", async () => {
    const fixture = await holdServiceFixture([initiallyFree]);
    fixtures.push(fixture);
    registerFixture(fixture);

    const previewResponse = await createPreview(
      mutationRequest(`/api/viewings/${fixture.viewingId}/approval`, {
        contactNotes: "Ask whether keys can be collected at the leasing office.",
        remindersMinutesBeforeStart: [30]
      }),
      context(fixture.viewingId)
    );
    const preview = CalendarHoldPreviewResponseSchema.parse(await previewResponse.json());
    expect(previewResponse.status).toBe(201);

    const approvalResponse = await approvePreview(
      mutationRequest(`/api/viewings/${fixture.viewingId}/approval`, {
        holdId: preview.hold.id,
        expectedPayloadHash: preview.preview.payloadHash
      }),
      context(fixture.viewingId)
    );
    const approved = ApproveCalendarHoldResponseSchema.parse(await approvalResponse.json());
    expect(approvalResponse.status).toBe(200);

    const requestBody = {
      approvalId: approved.approval.id,
      expectedPayloadHash: preview.preview.payloadHash,
      conflictCheckOverride: false,
      correlationId: "route-calendar-hold-correlation"
    };
    const createdResponse = await createHold(
      mutationRequest(`/api/viewings/${fixture.viewingId}/hold`, requestBody),
      context(fixture.viewingId)
    );
    const created = CreateApprovedCalendarHoldResponseSchema.parse(await createdResponse.json());
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({ kind: "created", duplicate: false });
    expect(fixture.client.insertCalls).toHaveLength(1);
    expect(fixture.client.insertCalls[0]).toMatchObject({
      attendees: [],
      sendUpdates: "none",
      status: "tentative",
      visibility: "private"
    });

    const replayResponse = await createHold(
      mutationRequest(`/api/viewings/${fixture.viewingId}/hold`, requestBody),
      context(fixture.viewingId)
    );
    const replay = CreateApprovedCalendarHoldResponseSchema.parse(await replayResponse.json());
    expect(replay).toMatchObject({ kind: "created", duplicate: true });
    expect(fixture.client.insertCalls).toHaveLength(1);
  });
});
