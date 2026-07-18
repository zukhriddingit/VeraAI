import {
  ConnectorHealthSchema,
  ManualStructuredCaptureRequestSchema,
  ManualTextCaptureRequestSchema,
  RawListingEnvelopeSchema,
  type CaptureRequest,
  type CaptureSourceConnector,
  type ConnectorContext,
  type ConnectorHealth,
  type ManualCaptureRequest,
  type ManualStructuredCaptureRequest,
  type RawListingEnvelope
} from "./contracts.ts";
import type { SourcePolicyRegistry } from "@vera/policy";
import {
  ConnectorCaptureError,
  MalformedCapturePayloadError,
  UnsupportedSourceError
} from "./errors.ts";
import { validateAndClassifyProvenanceUrl, type UrlClassification } from "./url-policy.ts";

export const MANUAL_CAPTURE_CONNECTOR_ID = "manual.capture.v1";

function observedAt(context: ConnectorContext): string {
  const now = context.now();
  if (Number.isNaN(now.getTime())) {
    throw new ConnectorCaptureError({
      connectorId: MANUAL_CAPTURE_CONNECTOR_ID,
      reason: "invalid_clock_value"
    });
  }
  return now.toISOString();
}

function parseManualRequest(request: ManualCaptureRequest): ManualCaptureRequest {
  const schema =
    request.kind === "manual_text"
      ? ManualTextCaptureRequestSchema
      : ManualStructuredCaptureRequestSchema;
  const result = schema.safeParse(request);
  if (!result.success) {
    const sourceIssue = result.error.issues.some(
      (issue) => issue.path.join(".") === "listing.source"
    );
    if (sourceIssue) {
      throw new UnsupportedSourceError({
        connectorId: MANUAL_CAPTURE_CONNECTOR_ID,
        reason: "invalid_source_label"
      });
    }
    throw new MalformedCapturePayloadError({
      connectorId: MANUAL_CAPTURE_CONNECTOR_ID,
      requestKind: request.kind,
      reason: "schema_validation_failed"
    });
  }
  return result.data;
}

function resolveStructuredUrl(request: ManualStructuredCaptureRequest): UrlClassification | null {
  const requestUrl = request.sourceUrl;
  const listingUrl = request.listing.url ?? undefined;
  if (requestUrl === undefined && listingUrl === undefined) {
    return null;
  }

  const requestClassification =
    requestUrl === undefined ? null : validateAndClassifyProvenanceUrl(requestUrl);
  const listingClassification =
    listingUrl === undefined ? null : validateAndClassifyProvenanceUrl(listingUrl);

  if (
    requestClassification !== null &&
    listingClassification !== null &&
    requestClassification.canonicalUrl !== listingClassification.canonicalUrl
  ) {
    throw new MalformedCapturePayloadError({
      connectorId: MANUAL_CAPTURE_CONNECTOR_ID,
      requestKind: request.kind,
      reason: "conflicting_provenance_urls"
    });
  }
  return requestClassification ?? listingClassification;
}

function assertSourceMatchesUrl(
  declaredSource: ManualStructuredCaptureRequest["listing"]["source"],
  classification: UrlClassification | null
): void {
  if (classification !== null && declaredSource !== classification.source) {
    throw new UnsupportedSourceError({
      connectorId: MANUAL_CAPTURE_CONNECTOR_ID,
      reason: "source_url_conflict"
    });
  }
}

export class ManualCaptureConnector implements CaptureSourceConnector<ManualCaptureRequest> {
  readonly connectorId = MANUAL_CAPTURE_CONNECTOR_ID;
  readonly displayName = "Manual capture";
  readonly source = "other" as const;
  readonly acquisitionMode = "user_capture" as const;
  readonly capability = "manual.capture" as const;
  readonly policyRequirement = {
    connectorId: this.connectorId,
    acquisitionMode: this.acquisitionMode,
    capability: this.capability,
    operation: "capture.user_supplied"
  } as const;
  readonly operations = ["capture"] as const;
  readonly cursorState = null;

  supports(request: CaptureRequest): request is ManualCaptureRequest {
    return request.kind === "manual_text" || request.kind === "manual_structured";
  }

  capture(request: ManualCaptureRequest, context: ConnectorContext): RawListingEnvelope {
    const parsed = parseManualRequest(request);
    if (parsed.kind === "manual_text") {
      const classification = validateAndClassifyProvenanceUrl(parsed.sourceUrl);
      return RawListingEnvelopeSchema.parse({
        connectorId: this.connectorId,
        capability: this.capability,
        acquisitionMode: this.acquisitionMode,
        source: classification.source,
        sourceListingId: null,
        sourceUrl: classification.canonicalUrl,
        captureMethod: "manual_text",
        observedAt: observedAt(context),
        sourcePostedAt: null,
        rawText: parsed.listingText,
        rawJson: null,
        captureMetadata: {
          networkAccess: false,
          untrustedContent: true,
          browserAccess: classification.browserAccess
        }
      });
    }

    const classification = resolveStructuredUrl(parsed);
    assertSourceMatchesUrl(parsed.listing.source, classification);
    return RawListingEnvelopeSchema.parse({
      connectorId: this.connectorId,
      capability: this.capability,
      acquisitionMode: this.acquisitionMode,
      source: classification?.source ?? parsed.listing.source,
      sourceListingId: parsed.listing.sourceListingId ?? null,
      sourceUrl: classification?.canonicalUrl ?? null,
      captureMethod: "manual_structured",
      observedAt: observedAt(context),
      sourcePostedAt: parsed.listing.sourcePostedAt ?? null,
      rawText: null,
      rawJson: parsed.listing,
      captureMetadata: {
        networkAccess: false,
        untrustedContent: true,
        browserAccess: classification?.browserAccess ?? "not_applicable"
      }
    });
  }

  health(registry: SourcePolicyRegistry): ConnectorHealth {
    const decision = registry.evaluate({
      connectorId: this.connectorId,
      acquisitionMode: this.acquisitionMode,
      capability: this.capability,
      execution: "manual",
      operation: "capture.user_supplied",
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
        ? "Stores only listing evidence supplied directly by the user; URLs are not fetched."
        : `Denied by source policy: ${decision.reason}.`
    });
  }
}
