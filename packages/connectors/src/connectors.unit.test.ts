import { describe, expect, it } from "vitest";
import { INITIAL_LOCAL_MANIFESTS, SourcePolicyRegistry } from "@vera/policy";

import {
  ConnectorOperationResultSchema,
  FixtureCaptureRequestSchema,
  ManualStructuredCaptureRequestSchema,
  ManualTextCaptureRequestSchema,
  RawListingEnvelopeSchema,
  executeConnectorOperation,
  type CaptureRequest,
  type CaptureSourceConnector,
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
const PAYLOAD_HASH = "a".repeat(64);
const IDEMPOTENCY_KEY = "b".repeat(64);

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
  connector: CaptureSourceConnector<Request>;
  expectedId: string;
  expectedCapability: "fixture.read" | "manual.capture";
  expectedAcquisitionMode: "fixture" | "user_capture";
  supported: Request;
  unsupported: CaptureRequest;
}): void {
  describe(`${input.expectedId} contract`, () => {
    it("has stable identity and supports only its own request kind", () => {
      expect(input.connector.connectorId).toBe(input.expectedId);
      expect(input.connector.capability).toBe(input.expectedCapability);
      expect(input.connector.source).toBe("other");
      expect(input.connector.acquisitionMode).toBe(input.expectedAcquisitionMode);
      expect(input.connector.operations).toEqual(["capture"]);
      expect(input.connector.cursorState).toBeNull();
      expect(input.connector.policyRequirement).toMatchObject({
        connectorId: input.expectedId,
        acquisitionMode: input.expectedAcquisitionMode,
        capability: input.expectedCapability
      });
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
      expect(envelope.acquisitionMode).toBe(input.expectedAcquisitionMode);
      expect(envelope.observedAt).toBe(NOW.toISOString());
    });

    it.each(["discover", "fetch_detail"] as const)(
      "fails closed for unsupported %s without falling back to capture",
      async (operation) => {
        const result = await executeConnectorOperation(input.connector, {
          operation,
          correlationId: "correlation-1",
          payloadHash: PAYLOAD_HASH,
          idempotencyKey: IDEMPOTENCY_KEY,
          completedAt: NOW.toISOString()
        });

        expect(ConnectorOperationResultSchema.parse(result)).toEqual(result);
        expect(result).toMatchObject({
          connectorId: input.expectedId,
          source: "other",
          acquisitionMode: input.expectedAcquisitionMode,
          operation,
          status: "unsupported_operation",
          records: [],
          recordCount: 0,
          previousCursor: null,
          cursorCandidate: null,
          untrustedInput: true
        });
      }
    );

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
  expectedAcquisitionMode: "fixture",
  supported: fixtureRequest as FixtureCaptureRequest,
  unsupported: manualTextRequest
});

connectorContract({
  connector: new ManualCaptureConnector(),
  expectedId: "manual.capture.v1",
  expectedCapability: "manual.capture",
  expectedAcquisitionMode: "user_capture",
  supported: manualTextRequest as ManualCaptureRequest,
  unsupported: fixtureRequest
});

describe("FixtureConnector", () => {
  it("returns the same strict idempotent result envelope for the same execution", async () => {
    const connector = new FixtureConnector();
    const execution = {
      operation: "capture",
      correlationId: "correlation-1",
      payloadHash: PAYLOAD_HASH,
      idempotencyKey: IDEMPOTENCY_KEY,
      completedAt: NOW.toISOString()
    } as const;
    const executionContext = {
      connectorContext: context(),
      captureRequest: fixtureRequest as FixtureCaptureRequest
    };

    const first = await executeConnectorOperation(connector, execution, executionContext);
    const replay = await executeConnectorOperation(connector, execution, executionContext);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "completed",
      operation: "capture",
      records: [{ acquisitionMode: "fixture" }],
      recordCount: 1,
      untrustedInput: true
    });
    expect(first.resultHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => ConnectorOperationResultSchema.parse({ ...first, recordCount: 0 })).toThrow();
  });

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

describe("generic connector result envelopes", () => {
  it.each([
    ["official_api", "official_api", "structured_feed.read"],
    ["email_alert", "email_alert", "gmail.alert.read"],
    ["local_browser", "local_browser", "browser.capture"]
  ] as const)(
    "accepts untrusted %s evidence without treating it as a normalized listing",
    (acquisitionMode, captureMethod, capability) => {
      const envelope = RawListingEnvelopeSchema.parse({
        connectorId: `${acquisitionMode}.connector.v1`,
        capability,
        acquisitionMode,
        source: "other",
        sourceListingId: "source-1",
        sourceUrl: "https://housing.example/listing/1",
        captureMethod,
        observedAt: NOW.toISOString(),
        sourcePostedAt: null,
        rawText: null,
        rawJson: {
          providerPayload: {
            opaqueFields: ["untrusted", 7, null]
          }
        },
        captureMetadata: {
          networkAccess: true,
          untrustedContent: true,
          browserAccess:
            acquisitionMode === "local_browser" ? "policy_entry_present" : "not_applicable"
        }
      });

      expect(envelope).toMatchObject({ acquisitionMode, captureMethod, capability });
      expect(() =>
        RawListingEnvelopeSchema.parse({ ...envelope, acquisitionMode: "fixture" })
      ).toThrow();
      expect(() =>
        RawListingEnvelopeSchema.parse({
          ...envelope,
          capability: "manual.capture",
          captureMetadata: { ...envelope.captureMetadata, networkAccess: false }
        })
      ).toThrow();
    }
  );

  it("requires local-browser evidence to retain its explicit browser policy boundary", () => {
    const envelope = RawListingEnvelopeSchema.parse({
      connectorId: "local.browser.connector.v1",
      capability: "browser.capture",
      acquisitionMode: "local_browser",
      source: "other",
      sourceListingId: "source-1",
      sourceUrl: "https://housing.example/listing/1",
      captureMethod: "local_browser",
      observedAt: NOW.toISOString(),
      sourcePostedAt: null,
      rawText: "Untrusted browser evidence.",
      rawJson: null,
      captureMetadata: {
        networkAccess: true,
        untrustedContent: true,
        browserAccess: "policy_entry_present"
      }
    });

    expect(() =>
      RawListingEnvelopeSchema.parse({
        ...envelope,
        captureMetadata: { ...envelope.captureMetadata, browserAccess: "not_applicable" }
      })
    ).toThrow();
  });

  it("returns schema-validated recovery metadata for a typed connector failure", async () => {
    const connector: SourceConnector = {
      connectorId: "failing.connector.v1",
      displayName: "Failing connector",
      source: "other",
      acquisitionMode: "user_capture",
      capability: "manual.capture",
      policyRequirement: {
        connectorId: "failing.connector.v1",
        acquisitionMode: "user_capture",
        capability: "manual.capture",
        operation: "capture.user_supplied"
      },
      operations: ["capture"],
      cursorState: null,
      capture: () => {
        throw new MalformedCapturePayloadError({
          connectorId: "failing.connector.v1",
          requestKind: "manual_text",
          reason: "schema_validation_failed"
        });
      },
      health: () => {
        throw new Error("not used");
      }
    };

    const result = await executeConnectorOperation(
      connector,
      {
        operation: "capture",
        correlationId: "correlation-1",
        payloadHash: PAYLOAD_HASH,
        idempotencyKey: IDEMPOTENCY_KEY,
        completedAt: NOW.toISOString()
      },
      {
        connectorContext: context(),
        captureRequest: manualTextRequest
      }
    );

    expect(ConnectorOperationResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      status: "failed",
      records: [],
      failure: {
        code: "malformed_payload",
        category: "request_validation",
        retryable: false,
        recoveryAction: "correct_request",
        reasonCode: "schema_validation_failed"
      }
    });
  });

  it("distinguishes an invalid execution context from invalid connector output", async () => {
    const connector = new FixtureConnector();
    const request = {
      operation: "capture",
      correlationId: "correlation-1",
      payloadHash: PAYLOAD_HASH,
      idempotencyKey: IDEMPOTENCY_KEY,
      completedAt: NOW.toISOString()
    } as const;

    const missingContext = await executeConnectorOperation(connector, request);
    expect(missingContext.failure).toMatchObject({
      code: "invalid_execution_context",
      recoveryAction: "correct_request"
    });

    const invalidOutputConnector: SourceConnector = {
      ...connector,
      capture: () => ({
        ...connector.capture(fixtureRequest as FixtureCaptureRequest, context()),
        acquisitionMode: "official_api"
      }),
      health: (registry) => connector.health(registry)
    };
    const invalidOutput = await executeConnectorOperation(invalidOutputConnector, request, {
      connectorContext: context(),
      captureRequest: fixtureRequest
    });
    expect(invalidOutput.failure).toMatchObject({
      code: "invalid_connector_output",
      recoveryAction: "inspect_connector"
    });
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
