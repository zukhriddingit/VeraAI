import {
  ConnectorHealthSchema,
  FixtureCaptureRequestSchema,
  RawListingEnvelopeSchema,
  type CaptureRequest,
  type CaptureSourceConnector,
  type ConnectorContext,
  type ConnectorHealth,
  type FixtureCaptureRequest,
  type RawListingEnvelope
} from "./contracts.ts";
import type { SourcePolicyRegistry } from "@vera/policy";
import {
  ConnectorCaptureError,
  MalformedCapturePayloadError,
  UnsupportedSourceError
} from "./errors.ts";
import { validateAndClassifyProvenanceUrl } from "./url-policy.ts";

export const FIXTURE_CONNECTOR_ID = "fixture.feed.v1";

function isSanitizedFixtureHostname(hostname: string): boolean {
  return hostname === "example.invalid" || hostname.endsWith(".example.invalid");
}

function parseFixtureRequest(request: FixtureCaptureRequest): FixtureCaptureRequest {
  const result = FixtureCaptureRequestSchema.safeParse(request);
  if (!result.success) {
    const sourceIssue = result.error.issues.some(
      (issue) => issue.path.join(".") === "listing.source"
    );
    if (sourceIssue) {
      throw new UnsupportedSourceError({
        connectorId: FIXTURE_CONNECTOR_ID,
        reason: "invalid_source_label"
      });
    }
    throw new MalformedCapturePayloadError({
      connectorId: FIXTURE_CONNECTOR_ID,
      requestKind: "fixture",
      reason: "schema_validation_failed"
    });
  }
  return result.data;
}

function observedAt(context: ConnectorContext): string {
  const now = context.now();
  if (Number.isNaN(now.getTime())) {
    throw new ConnectorCaptureError({
      connectorId: FIXTURE_CONNECTOR_ID,
      reason: "invalid_clock_value"
    });
  }
  return now.toISOString();
}

export class FixtureConnector implements CaptureSourceConnector<FixtureCaptureRequest> {
  readonly connectorId = FIXTURE_CONNECTOR_ID;
  readonly displayName = "Sanitized fixture feed";
  readonly source = "other" as const;
  readonly acquisitionMode = "fixture" as const;
  readonly capability = "fixture.read" as const;
  readonly policyRequirement = {
    connectorId: this.connectorId,
    acquisitionMode: this.acquisitionMode,
    capability: this.capability,
    operation: "fixture.read_sanitized"
  } as const;
  readonly operations = ["capture"] as const;
  readonly cursorState = null;

  supports(request: CaptureRequest): request is FixtureCaptureRequest {
    return request.kind === "fixture";
  }

  capture(request: FixtureCaptureRequest, context: ConnectorContext): RawListingEnvelope {
    const parsed = parseFixtureRequest(request);
    let sourceUrl: string | null = null;

    if (parsed.listing.url != null) {
      const classification = validateAndClassifyProvenanceUrl(parsed.listing.url);
      if (!isSanitizedFixtureHostname(classification.hostname)) {
        throw new MalformedCapturePayloadError({
          connectorId: this.connectorId,
          requestKind: parsed.kind,
          reason: "fixture_url_must_be_synthetic"
        });
      }
      sourceUrl = classification.canonicalUrl;
    }

    return RawListingEnvelopeSchema.parse({
      connectorId: this.connectorId,
      capability: this.capability,
      acquisitionMode: this.acquisitionMode,
      source: parsed.listing.source,
      sourceListingId: parsed.listing.sourceListingId ?? null,
      sourceUrl,
      captureMethod: "fixture",
      observedAt: observedAt(context),
      sourcePostedAt: parsed.listing.sourcePostedAt ?? null,
      rawText: null,
      rawJson: parsed.listing,
      captureMetadata: {
        networkAccess: false,
        untrustedContent: true,
        browserAccess: "not_applicable"
      }
    });
  }

  health(registry: SourcePolicyRegistry): ConnectorHealth {
    const decision = registry.evaluate({
      connectorId: this.connectorId,
      acquisitionMode: this.acquisitionMode,
      capability: this.capability,
      execution: "manual",
      operation: "fixture.read_sanitized",
      hasUserSession: false,
      hasApproval: false,
      network: null
    });
    return ConnectorHealthSchema.parse({
      connectorId: this.connectorId,
      displayName: this.displayName,
      status: decision.allowed
        ? "ready"
        : decision.reason === "connector_disabled"
          ? "disabled"
          : "denied",
      capabilities: [this.capability],
      networkAccess: false,
      detail: decision.allowed
        ? "Imports sanitized local JSON without network access."
        : `Denied by source policy: ${decision.reason}.`
    });
  }
}
