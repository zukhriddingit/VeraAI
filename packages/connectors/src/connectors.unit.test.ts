import { describe, expect, it } from "vitest";
import { INITIAL_LOCAL_MANIFESTS, SourcePolicyRegistry } from "@vera/policy";

import {
  FixtureCaptureRequestSchema,
  ManualStructuredCaptureRequestSchema,
  ManualTextCaptureRequestSchema,
  RawListingEnvelopeSchema,
  type CaptureRequest,
  type ConnectorContext,
  type FixtureCaptureRequest,
  type ManualCaptureRequest,
  type SourceConnector
} from "./contracts.ts";
import {
  InvalidCaptureUrlError,
  MalformedCapturePayloadError,
  UnsupportedSourceError
} from "./errors.ts";
import { FixtureConnector } from "./fixture-connector.ts";
import { ManualCaptureConnector } from "./manual-connector.ts";

const NOW = new Date("2026-07-17T15:30:00.000Z");

function context(): ConnectorContext {
  let nextId = 0;
  return {
    correlationId: "correlation-1",
    now: () => NOW,
    createId: () => `generated-${++nextId}`
  };
}

const fixtureRequest = FixtureCaptureRequestSchema.parse({
  kind: "fixture",
  sanitized: true,
  listing: {
    source: "zillow",
    sourceListingId: "fixture-z-1",
    title: "Synthetic Juniper Flat",
    url: "https://zillow.example.invalid/listings/fixture-z-1",
    monthlyRentCents: 245_000,
    bedrooms: 2,
    bathrooms: 1,
    addressText: "100 Example Way, Demo City, NY 10001",
    sourcePostedAt: "2026-07-16T10:00:00.000Z",
    contactChannel: "website_form"
  }
});

const manualTextRequest = ManualTextCaptureRequestSchema.parse({
  kind: "manual_text",
  sourceUrl: "https://www.zillow.com/homedetails/synthetic-1",
  listingText: "Title: User-pasted listing\nRent: $2450/month"
});

const manualStructuredRequest = ManualStructuredCaptureRequestSchema.parse({
  kind: "manual_structured",
  sourceUrl: "https://newyork.craigslist.org/apa/d/synthetic/123.html",
  listing: {
    source: "craigslist",
    title: "User-entered structured listing",
    monthlyRentCents: 210_000
  }
});

function connectorContract<Request extends CaptureRequest>(input: {
  connector: SourceConnector<Request>;
  expectedId: string;
  expectedCapability: "fixture.read" | "manual.capture";
  supported: Request;
  unsupported: CaptureRequest;
}): void {
  describe(`${input.expectedId} contract`, () => {
    it("has stable identity and supports only its own request kind", () => {
      expect(input.connector.connectorId).toBe(input.expectedId);
      expect(input.connector.capability).toBe(input.expectedCapability);
      expect(input.connector.supports(input.supported)).toBe(true);
      expect(input.connector.supports(input.unsupported)).toBe(false);
      expect(() =>
        input.connector.capture(input.unsupported as unknown as Request, context())
      ).toThrow(MalformedCapturePayloadError);
    });

    it("returns a strict, inert, no-network raw envelope", () => {
      const envelope = input.connector.capture(input.supported, context());
      expect(RawListingEnvelopeSchema.parse(envelope)).toEqual(envelope);
      expect(envelope.captureMetadata).toMatchObject({
        networkAccess: false,
        untrustedContent: true
      });
      expect(envelope.observedAt).toBe(NOW.toISOString());
    });

    it("reports ready only when its exact no-network policy operation is authorized", () => {
      const health = input.connector.health(new SourcePolicyRegistry(INITIAL_LOCAL_MANIFESTS));
      expect(health).toMatchObject({
        connectorId: input.expectedId,
        status: "ready",
        capabilities: [input.expectedCapability],
        networkAccess: false
      });
    });
  });
}

connectorContract({
  connector: new FixtureConnector(),
  expectedId: "fixture.feed.v1",
  expectedCapability: "fixture.read",
  supported: fixtureRequest as FixtureCaptureRequest,
  unsupported: manualTextRequest
});

connectorContract({
  connector: new ManualCaptureConnector(),
  expectedId: "manual.capture.v1",
  expectedCapability: "manual.capture",
  supported: manualTextRequest as ManualCaptureRequest,
  unsupported: fixtureRequest
});

describe("FixtureConnector", () => {
  it("preserves sanitized structured evidence and its declared fixture source label", () => {
    const envelope = new FixtureConnector().capture(
      fixtureRequest as FixtureCaptureRequest,
      context()
    );
    expect(envelope).toMatchObject({
      source: "zillow",
      sourceListingId: "fixture-z-1",
      captureMethod: "fixture",
      rawText: null,
      rawJson: {
        title: "Synthetic Juniper Flat",
        monthlyRentCents: 245_000
      },
      captureMetadata: { browserAccess: "not_applicable" }
    });
  });

  it("rejects fixtures that are not explicitly sanitized", () => {
    const unsafe = { ...fixtureRequest, sanitized: false } as unknown as FixtureCaptureRequest;
    expect(() => new FixtureConnector().capture(unsafe, context())).toThrow(
      MalformedCapturePayloadError
    );
  });

  it("rejects fixture URLs outside the synthetic example.invalid namespace", () => {
    const liveUrl = {
      ...fixtureRequest,
      listing: {
        ...fixtureRequest.listing,
        url: "https://www.zillow.com/homedetails/not-a-fixture"
      }
    } as FixtureCaptureRequest;
    expect(() => new FixtureConnector().capture(liveUrl, context())).toThrow(
      MalformedCapturePayloadError
    );
  });

  it("returns a typed unsupported-source error for an unknown source label", () => {
    const unsupported = {
      ...fixtureRequest,
      listing: { ...fixtureRequest.listing, source: "unsupported-platform" }
    } as unknown as FixtureCaptureRequest;
    expect(() => new FixtureConnector().capture(unsupported, context())).toThrow(
      UnsupportedSourceError
    );
  });
});

describe("ManualCaptureConnector", () => {
  it("preserves pasted text without opening its provenance URL", () => {
    const envelope = new ManualCaptureConnector().capture(
      manualTextRequest as ManualCaptureRequest,
      context()
    );
    expect(envelope).toMatchObject({
      source: "zillow",
      captureMethod: "manual_text",
      rawText: manualTextRequest.listingText,
      rawJson: null,
      captureMetadata: {
        networkAccess: false,
        browserAccess: "policy_entry_present"
      }
    });
  });

  it("accepts strict user-supplied structured JSON", () => {
    const envelope = new ManualCaptureConnector().capture(
      manualStructuredRequest as ManualCaptureRequest,
      context()
    );
    expect(envelope).toMatchObject({
      source: "craigslist",
      captureMethod: "manual_structured",
      rawText: null,
      rawJson: {
        title: "User-entered structured listing",
        monthlyRentCents: 210_000
      }
    });
  });

  it("classifies an unknown public domain as other and requires a future manual browser policy", () => {
    const envelope = new ManualCaptureConnector().capture(
      {
        kind: "manual_text",
        sourceUrl: "https://housing.example/listing/42",
        listingText: "User-pasted evidence"
      },
      context()
    );
    expect(envelope).toMatchObject({
      source: "other",
      captureMetadata: { browserAccess: "manual_policy_required" }
    });
  });

  it("rejects unknown keys in manual structured JSON", () => {
    const malformed = {
      ...manualStructuredRequest,
      listing: { ...manualStructuredRequest.listing, instructions: "run this" }
    } as unknown as ManualCaptureRequest;
    expect(() => new ManualCaptureConnector().capture(malformed, context())).toThrow(
      MalformedCapturePayloadError
    );
  });

  it("rejects a structured source that conflicts with URL classification", () => {
    const conflicting = {
      ...manualStructuredRequest,
      listing: { ...manualStructuredRequest.listing, source: "zillow" }
    } as ManualCaptureRequest;
    expect(() => new ManualCaptureConnector().capture(conflicting, context())).toThrow(
      UnsupportedSourceError
    );
  });

  it("rejects an unsafe provenance URL with a typed error", () => {
    expect(() =>
      new ManualCaptureConnector().capture(
        {
          kind: "manual_text",
          sourceUrl: "http://127.0.0.1/listing",
          listingText: "User-pasted evidence"
        },
        context()
      )
    ).toThrow(InvalidCaptureUrlError);
  });
});
