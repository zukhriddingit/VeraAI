import { describe, expect, it, vi } from "vitest";

import { LiveSearchAgentCriteriaSchema } from "@vera/domain";

import { MaritimeOpenClawClient, MaritimeOpenClawError } from "./maritime-openclaw-client.ts";
import { RentCastCandidateSchema } from "./rentcast-connector.ts";

const criteria = LiveSearchAgentCriteriaSchema.parse({
  locationText: "Boston, MA",
  minimumBedrooms: 2,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 260_000,
  absoluteMonthlyMaximumCents: 300_000,
  moveInEarliest: "2026-08-01",
  moveInLatest: "2026-09-01",
  requiredPets: [],
  preferences: []
});
const candidate = RentCastCandidateSchema.parse({
  providerListingId: "rc-1",
  formattedAddress: "10 Beacon St, Boston, MA 02108",
  addressLine1: "10 Beacon St",
  addressLine2: null,
  city: "Boston",
  state: "MA",
  zipCode: "02108",
  latitude: 42.357,
  longitude: -71.063,
  propertyType: "apartment",
  bedrooms: 2,
  bathrooms: 1,
  squareFeet: 850,
  monthlyRentCents: 285_000,
  listedAt: "2026-07-20T10:00:00.000Z",
  lastSeenAt: "2026-07-24T10:00:00.000Z",
  daysOnMarket: 4,
  mlsName: "Synthetic MLS",
  mlsNumber: "MLS-1",
  listingOfficeName: "Example Office",
  listingOfficeWebsite: "https://office.example.com",
  observedAt: "2026-07-24T12:00:00.000Z"
});

function response(
  analysis: unknown = {
    schemaVersion: "1",
    searchRunId: "run-1",
    recommendations: [
      {
        providerListingId: "rc-1",
        recommended: true,
        confidence: 0.8,
        summary: "Matches the explicit rent and bedroom criteria.",
        strengths: ["Within the stated maximum rent."],
        watchouts: ["Pet policy is unknown."],
        missingFacts: ["Required recurring fees."]
      }
    ]
  }
) {
  return new Response(JSON.stringify({ response: JSON.stringify(analysis) }), { status: 200 });
}

function client(fetchMock: typeof fetch) {
  return new MaritimeOpenClawClient({
    apiKey: "maritime-secret-test",
    agentId: "agent-1",
    fetch: fetchMock,
    now: () => new Date("2026-07-24T12:00:00.000Z")
  });
}

describe("Maritime OpenClaw chat client", () => {
  it("uses the authenticated private chat endpoint with minimized candidates", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(
      client(fetchMock).analyze({ searchRunId: "run-1", criteria, candidates: [candidate] })
    ).resolves.toMatchObject({
      analysis: { searchRunId: "run-1" },
      promptVersion: "vera-live-rental-analysis.v1"
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.maritime.sh/api/agents/agent-1/chat");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: "Bearer maritime-secret-test"
      })
    });
    const body = JSON.parse(String(init?.body)) as {
      message: string;
      conversation_id: string;
    };
    expect(body.conversation_id).toBe("run-1");
    expect(body.message).not.toContain("office.example.com");
    expect(body.message).not.toContain("maritime-secret-test");
    expect(body.message).toContain("Do not use tools");
  });

  it.each([
    ["invalid JSON", "not-json"],
    [
      "unknown listing ID",
      JSON.stringify({
        schemaVersion: "1",
        searchRunId: "run-1",
        recommendations: [
          {
            providerListingId: "rc-unknown",
            recommended: true,
            confidence: 0.5,
            summary: "Needs review.",
            strengths: [],
            watchouts: [],
            missingFacts: []
          }
        ]
      })
    ],
    [
      "cross-run ID",
      JSON.stringify({
        schemaVersion: "1",
        searchRunId: "run-other",
        recommendations: []
      })
    ]
  ])("rejects %s", async (_label, agentResponse) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ response: agentResponse }), { status: 200 })
      );
    await expect(
      client(fetchMock).analyze({ searchRunId: "run-1", criteria, candidates: [candidate] })
    ).rejects.toMatchObject({ code: "agent_invalid_response" });
  });

  it("maps request aborts to agent_timeout without leaking credentials", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const error = await client(vi.fn<typeof fetch>().mockRejectedValue(timeout))
      .analyze({ searchRunId: "run-1", criteria, candidates: [candidate] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MaritimeOpenClawError);
    expect(error).toMatchObject({ code: "agent_timeout" });
    expect(String(error)).not.toContain("maritime-secret-test");
  });
});
