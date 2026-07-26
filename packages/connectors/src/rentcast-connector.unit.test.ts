import { describe, expect, it, vi } from "vitest";

import { SearchProfileSchema } from "@vera/domain";

import {
  RentCastConnector,
  RentCastConnectorError,
  RentCastRentalQuerySchema,
  buildRentCastRentalQuery
} from "./rentcast-connector.ts";

const profile = SearchProfileSchema.parse({
  id: "profile-1",
  name: "Boston founder search",
  version: 1,
  locationText: "Boston, MA",
  centerLatitude: null,
  centerLongitude: null,
  radiusKilometers: null,
  minimumBedrooms: 2,
  minimumBathrooms: 1,
  targetMonthlyTotalCents: 260_000,
  absoluteMonthlyMaximumCents: 300_000,
  moveInEarliest: "2026-08-01",
  moveInLatest: "2026-09-01",
  petRequirements: [],
  commuteAnchors: [],
  hardConstraints: [],
  weightedPreferences: [],
  notificationRules: { enabled: false, minimumScoreBasisPoints: null },
  createdAt: "2026-07-24T00:00:00.000Z",
  updatedAt: "2026-07-24T00:00:00.000Z"
});

const query = buildRentCastRentalQuery(profile);
const providerListings = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/rentcast-rental-listings.synthetic.json", import.meta.url),
    "utf8"
  )
) as unknown;

describe("RentCast connector", () => {
  it("translates only explicit bounded profile parameters", () => {
    expect(query).toEqual({
      city: "Boston",
      state: "MA",
      bedrooms: "2:*",
      bathrooms: "1:*",
      price: "*:3000",
      status: "Active",
      limit: 10
    });
    expect(() => RentCastRentalQuerySchema.parse({ ...query, limit: 11 })).toThrow();
    expect(() => RentCastRentalQuerySchema.parse({ ...query, offset: 10 })).toThrow();
  });

  it("minimizes provider results and never persists contact fields", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(providerListings), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const connector = new RentCastConnector({
      apiKey: "rentcast-secret-test",
      fetch: fetchMock,
      now: () => new Date("2026-07-24T12:00:00.000Z")
    });
    const result = await connector.search(query);
    const serialized = JSON.stringify(result);
    expect(result.candidates).toHaveLength(1);
    expect(
      connector.toEnvelope(result.candidates[0]!, result.queryHash, null).rawJson
    ).toMatchObject({
      monthlyRentCents: 285_000,
      baseRent: {
        amountMinorUnits: 285_000,
        currency: "USD",
        billingPeriod: "month",
        rawAmount: "$2850.00/month"
      }
    });
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("555");
    expect(serialized).not.toContain("rentcast-secret-test");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "https://api.rentcast.io",
        pathname: "/v1/listings/rental/long-term"
      }),
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({ "X-Api-Key": "rentcast-secret-test" })
      })
    );
  });

  it.each([
    [401, "provider_auth_failed"],
    [429, "provider_rate_limited"]
  ])("maps HTTP %s to %s without leaking the key", async (status, code) => {
    const connector = new RentCastConnector({
      apiKey: "rentcast-secret-test",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }))
    });
    const error = await connector.search(query).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RentCastConnectorError);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("rentcast-secret-test");
  });

  it("treats the provider's documented 404 as no live matches, not fixture success", async () => {
    const connector = new RentCastConnector({
      apiKey: "rentcast-secret-test",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 404 }))
    });
    await expect(connector.search(query)).resolves.toMatchObject({ candidates: [] });
  });

  it("maps request aborts to a bounded provider timeout", async () => {
    const connector = new RentCastConnector({
      apiKey: "rentcast-secret-test",
      maxAttempts: 1,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out", "TimeoutError"))
    });
    await expect(connector.search(query)).rejects.toMatchObject({
      code: "provider_timeout"
    });
  });

  it("does not substitute fixture data on provider failure", async () => {
    const connector = new RentCastConnector({
      apiKey: "rentcast-secret-test",
      maxAttempts: 1,
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"))
    });
    await expect(connector.search(query)).rejects.toMatchObject({
      code: "provider_unavailable"
    });
  });
});
import { readFileSync } from "node:fs";
