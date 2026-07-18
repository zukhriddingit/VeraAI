import {
  CaptureRequestSchema,
  CaptureResultSchema,
  ConnectorPolicyDeniedError,
  InvalidCaptureUrlError,
  MalformedCapturePayloadError,
  UnsupportedConnectorError,
  UnsupportedSourceError,
  isConnectorError,
  type CaptureRequest,
  type ConnectorContext,
  type SourceConnector
} from "@vera/connectors";
import { canonicalJson, sha256Text, type VeraRepositories } from "@vera/db/runtime";
import {
  ActivityEventSchema,
  CaptureAcceptedResponseSchema,
  CaptureExtractionRunSummarySchema,
  CaptureFieldSummarySchema,
  JsonValueSchema,
  ListingExtractionFieldNameSchema,
  RawListingCaptureSchema,
  type ActivityEvent,
  type CaptureAcceptedResponse,
  type CaptureErrorCode,
  type CaptureExtractionRunSummary,
  type CaptureFieldSummary,
  type ErrorCategory,
  type FieldProvenance,
  type ListingExtractionRun,
  type ListingSourceRecord,
  type PolicyDecision
} from "@vera/domain";
import type { SourcePolicyRegistry } from "@vera/policy";

export interface CaptureServiceDependencies {
  readonly repositories: VeraRepositories;
  readonly connectors: readonly SourceConnector[];
  readonly policyRegistry: SourcePolicyRegistry;
  now(): Date;
  createId(): string;
}

export class CaptureServiceError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    message: string,
    readonly correlationId: string,
    readonly retryable: boolean,
    readonly errorCategory: ErrorCategory
  ) {
    super(message);
    this.name = "CaptureServiceError";
  }
}

const extractionFieldOrder = ListingExtractionFieldNameSchema.options;
const captureFieldOrder = [...extractionFieldOrder, "sourceUrl", "source"] as const;

function limitedDisplayValue(value: string): string {
  return value.length <= 1_000 ? value : `${value.slice(0, 999)}…`;
}

function formatCurrency(amountMinorUnits: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amountMinorUnits % 100 === 0 ? 0 : 2
  }).format(amountMinorUnits / 100);
}

function extractionDisplayValue(fieldPath: string, value: unknown): string {
  if (fieldPath === "baseRent") {
    const money = value as {
      amountMinorUnits: number;
      currency: string;
      billingPeriod: string;
    };
    return `${formatCurrency(money.amountMinorUnits, money.currency)}/${money.billingPeriod}`;
  }

  if (fieldPath === "requiredRecurringFees") {
    const fees = value as readonly {
      label: string;
      amount: { amountMinorUnits: number; currency: string; billingPeriod: string };
    }[];
    if (fees.length === 0) return "None provided";
    return fees
      .map(
        (fee) =>
          `${fee.label}: ${formatCurrency(fee.amount.amountMinorUnits, fee.amount.currency)}/${fee.amount.billingPeriod}`
      )
      .join(", ");
  }

  if (fieldPath === "amenities") {
    const amenities = value as readonly string[];
    return amenities.length === 0 ? "None provided" : amenities.join(", ");
  }

  if (fieldPath === "catsAllowed" || fieldPath === "dogsAllowed") {
    return value === true ? "Yes" : "No";
  }

  if (fieldPath === "leaseTermMonths") {
    return `${String(value)} months`;
  }

  if (fieldPath === "squareFeet") {
    return `${String(value)} sq ft`;
  }

  return String(value);
}

function legacyDisplayValue(path: string, record: ListingSourceRecord): string | null {
  switch (path) {
    case "title":
      return record.title;
    case "sourceUrl":
      return record.sourceUrl;
    case "source":
      return record.source;
    case "baseRent":
    case "monthlyRentCents":
      return record.monthlyRentCents === null
        ? null
        : `${formatCurrency(record.monthlyRentCents, "USD")}/month`;
    case "bedrooms":
      return record.bedrooms === null ? null : String(record.bedrooms);
    case "bathrooms":
      return record.bathrooms === null ? null : String(record.bathrooms);
    case "addressText":
    case "address.line1":
      return record.address.line1;
    case "squareFeet":
      return record.squareFeet === null ? null : `${String(record.squareFeet)} sq ft`;
    case "propertyType":
      return record.propertyType;
    case "availableOn":
      return record.availableOn;
    case "leaseTermMonths":
      return record.leaseTermMonths === null ? null : `${String(record.leaseTermMonths)} months`;
    case "amenities":
      return record.amenities.length === 0 ? "None provided" : record.amenities.join(", ");
    case "sourcePostedAt":
      return record.sourcePostedAt;
    case "contactChannel":
      return record.contactChannel === "unknown" ? null : record.contactChannel;
    default:
      return null;
  }
}

function knownExplanation(method: FieldProvenance["extractionMethod"]): string {
  switch (method) {
    case "fixture_structured":
    case "manual":
      return "Provided in structured capture.";
    case "rule":
      return "Matched supplied listing evidence with a deterministic rule.";
    case "ai":
      return "Filled a requested missing field from the quoted evidence after schema and evidence validation.";
  }
}

function unknownExplanation(reason: string): string {
  switch (reason) {
    case "ambiguous":
      return "The supplied evidence was ambiguous, so this field remains unknown.";
    case "conflicting_evidence":
      return "The supplied evidence conflicted, so this field remains unknown.";
    case "unrecognized_format":
      return "The supplied evidence could not be normalized to a supported value, so this field remains unknown.";
    case "missing_evidence":
    case "not_present":
    default:
      return "No supported value was found in the supplied evidence, so this field remains unknown.";
  }
}

function captureField(
  provenance: FieldProvenance,
  record: ListingSourceRecord,
  extractionRun: ListingExtractionRun | null
): CaptureFieldSummary {
  const extractionField = ListingExtractionFieldNameSchema.safeParse(provenance.fieldPath);
  const extracted =
    extractionRun && extractionField.success
      ? extractionRun.mergedExtraction[extractionField.data]
      : null;

  if (extracted !== null) {
    const consistent =
      extracted.status === provenance.valueStatus &&
      extracted.confidenceBasisPoints === provenance.confidenceBasisPoints &&
      extracted.evidenceSnippet === provenance.evidenceExcerpt;
    if (!consistent) {
      throw new Error(`Stored extraction evidence is inconsistent for ${provenance.fieldPath}.`);
    }

    if (extracted.status === "known") {
      return CaptureFieldSummarySchema.parse({
        fieldPath: provenance.fieldPath,
        status: "known",
        displayValue: limitedDisplayValue(
          extractionDisplayValue(provenance.fieldPath, extracted.value)
        ),
        unknownReason: null,
        extractionMethod: provenance.extractionMethod,
        confidenceBasisPoints: provenance.confidenceBasisPoints,
        evidenceSnippet: provenance.evidenceExcerpt,
        explanation: knownExplanation(provenance.extractionMethod)
      });
    }

    return CaptureFieldSummarySchema.parse({
      fieldPath: provenance.fieldPath,
      status: "unknown",
      displayValue: null,
      unknownReason: extracted.reason,
      extractionMethod: provenance.extractionMethod,
      confidenceBasisPoints: 0,
      evidenceSnippet: null,
      explanation: unknownExplanation(extracted.reason)
    });
  }

  const displayValue =
    provenance.valueStatus === "known" ? legacyDisplayValue(provenance.fieldPath, record) : null;
  if (provenance.valueStatus === "known" && displayValue === null) {
    throw new Error(`Stored evidence has no safe display projection for ${provenance.fieldPath}.`);
  }

  return CaptureFieldSummarySchema.parse({
    fieldPath: provenance.fieldPath,
    status: provenance.valueStatus,
    displayValue: displayValue === null ? null : limitedDisplayValue(displayValue),
    unknownReason: provenance.valueStatus === "unknown" ? provenance.unknownReason : null,
    extractionMethod: provenance.extractionMethod,
    confidenceBasisPoints: provenance.confidenceBasisPoints,
    evidenceSnippet: provenance.evidenceExcerpt,
    explanation:
      provenance.valueStatus === "known"
        ? knownExplanation(provenance.extractionMethod)
        : unknownExplanation(provenance.unknownReason ?? "missing_evidence")
  });
}

export function projectCaptureFields(input: {
  readonly record: ListingSourceRecord;
  readonly provenance: readonly FieldProvenance[];
  readonly extractionRun: ListingExtractionRun | null;
}): CaptureFieldSummary[] {
  const byPath = new Map(input.provenance.map((entry) => [entry.fieldPath, entry]));
  const ordered = captureFieldOrder.flatMap((fieldPath) => {
    const provenance = byPath.get(fieldPath);
    return provenance ? [captureField(provenance, input.record, input.extractionRun)] : [];
  });
  const remaining = input.provenance
    .filter((entry) => !captureFieldOrder.some((fieldPath) => fieldPath === entry.fieldPath))
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath))
    .map((entry) => captureField(entry, input.record, input.extractionRun));

  return [...ordered, ...remaining];
}

export function projectCaptureExtractionRun(
  run: ListingExtractionRun | null
): CaptureExtractionRunSummary | null {
  if (run === null) return null;

  return CaptureExtractionRunSummarySchema.parse({
    mode: run.mode,
    providerId: run.providerId,
    model: run.model,
    promptVersion: run.promptVersion,
    extractionVersion: run.extractionVersion,
    requestedFields: run.requestedFields,
    requestedFieldCount: run.requestedFields.length,
    usage: run.usage,
    latencyMilliseconds: run.latencyMilliseconds,
    repairCount: run.repairCount,
    completedAt: run.completedAt
  });
}

function safeNow(dependencies: CaptureServiceDependencies): string {
  const value = dependencies.now();

  if (Number.isNaN(value.getTime())) {
    throw new Error("Capture clock returned an invalid time.");
  }

  return value.toISOString();
}

function event(input: Omit<ActivityEvent, "approvalId"> & { approvalId?: null }): ActivityEvent {
  return ActivityEventSchema.parse({ ...input, approvalId: input.approvalId ?? null });
}

function requestKind(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    return null;
  }

  return typeof input.kind === "string" ? input.kind : null;
}

function parseCaptureRequest(input: unknown, correlationId: string): CaptureRequest {
  const parsed = CaptureRequestSchema.safeParse(input);

  if (parsed.success) {
    return parsed.data;
  }

  const kind = requestKind(input);
  const unsupportedKind =
    kind !== null && !["fixture", "manual_text", "manual_structured"].includes(kind);
  const unsupportedSource = parsed.error.issues.some((issue) => issue.path.includes("source"));

  if (unsupportedKind) {
    throw new CaptureServiceError(
      "unsupported_connector",
      "No connector supports this capture request.",
      correlationId,
      false,
      "validation"
    );
  }

  if (unsupportedSource) {
    throw new CaptureServiceError(
      "unsupported_source",
      "The structured source label is unsupported.",
      correlationId,
      false,
      "validation"
    );
  }

  throw new CaptureServiceError(
    "malformed_request",
    "The capture request is malformed.",
    correlationId,
    false,
    "validation"
  );
}

function selectConnector(
  request: CaptureRequest,
  connectors: readonly SourceConnector[],
  correlationId: string
): SourceConnector {
  const connector = connectors.find((candidate) => candidate.supports(request));

  if (!connector) {
    throw new CaptureServiceError(
      "unsupported_connector",
      "No connector supports this capture request.",
      correlationId,
      false,
      "validation"
    );
  }

  return connector;
}

function operationFor(request: CaptureRequest): "fixture.read_sanitized" | "capture.user_supplied" {
  return request.kind === "fixture" ? "fixture.read_sanitized" : "capture.user_supplied";
}

function mapFailure(error: unknown, correlationId: string): CaptureServiceError {
  if (error instanceof CaptureServiceError) {
    return error;
  }

  if (error instanceof ConnectorPolicyDeniedError) {
    return new CaptureServiceError(
      "policy_denied",
      "Source policy denied this capture.",
      correlationId,
      false,
      "policy_denial"
    );
  }

  if (error instanceof UnsupportedConnectorError) {
    return new CaptureServiceError(
      "unsupported_connector",
      error.message,
      correlationId,
      false,
      "validation"
    );
  }

  if (error instanceof UnsupportedSourceError) {
    return new CaptureServiceError(
      "unsupported_source",
      error.message,
      correlationId,
      false,
      "validation"
    );
  }

  if (error instanceof MalformedCapturePayloadError || error instanceof InvalidCaptureUrlError) {
    return new CaptureServiceError(
      "malformed_request",
      error.message,
      correlationId,
      false,
      "validation"
    );
  }

  if (isConnectorError(error)) {
    return new CaptureServiceError(
      "capture_failed",
      error.message,
      correlationId,
      false,
      "internal"
    );
  }

  return new CaptureServiceError(
    "capture_failed",
    "The capture could not be completed safely.",
    correlationId,
    true,
    "internal"
  );
}

function appendFailure(
  repositories: VeraRepositories,
  failure: CaptureServiceError,
  input: {
    id: string;
    causationId: string;
    targetId: string;
    payloadHash: string;
    policyDecision: PolicyDecision;
    occurredAt: string;
  }
): void {
  repositories.activityEvents.append(
    event({
      id: input.id,
      correlationId: failure.correlationId,
      causationId: input.causationId,
      actor: "system",
      action: "capture.failed",
      targetType: "capture",
      targetId: input.targetId,
      policyDecision: input.policyDecision,
      payloadHash: input.payloadHash,
      outcome: "failed",
      errorCategory: failure.errorCategory,
      metadata: { errorCode: failure.code, retryable: failure.retryable },
      occurredAt: input.occurredAt
    })
  );
}

export function captureListing(
  input: unknown,
  dependencies: CaptureServiceDependencies
): CaptureAcceptedResponse {
  const correlationId = dependencies.createId();
  const occurredAt = safeNow(dependencies);
  const payload = JsonValueSchema.safeParse(input);
  const payloadHash = sha256Text(
    `capture-request:v1:${canonicalJson(payload.success ? payload.data : null)}`
  );
  const requestedEventId = dependencies.createId();

  dependencies.repositories.activityEvents.append(
    event({
      id: requestedEventId,
      correlationId,
      causationId: null,
      actor: "user",
      action: "capture.requested",
      targetType: "capture",
      targetId: correlationId,
      policyDecision: "not_applicable",
      payloadHash,
      outcome: "recorded",
      errorCategory: null,
      metadata: { requestKind: requestKind(input) ?? "invalid" },
      occurredAt
    })
  );

  let lastEventId = requestedEventId;
  let failurePolicyDecision: PolicyDecision = "not_applicable";
  let failureTargetId = correlationId;

  try {
    const request = parseCaptureRequest(input, correlationId);
    const connector = selectConnector(request, dependencies.connectors, correlationId);
    const policy = dependencies.policyRegistry.evaluate({
      connectorId: connector.connectorId,
      capability: connector.capability,
      execution: "manual",
      operation: operationFor(request),
      hasUserSession: false,
      hasApproval: false,
      network: null
    });
    const policyEventId = dependencies.createId();
    lastEventId = policyEventId;
    failurePolicyDecision = policy.allowed ? "authorized" : "denied";

    dependencies.repositories.activityEvents.append(
      event({
        id: policyEventId,
        correlationId,
        causationId: requestedEventId,
        actor: "system",
        action: policy.allowed ? "capture.policy_authorized" : "capture.policy_denied",
        targetType: "connector",
        targetId: connector.connectorId,
        policyDecision: policy.allowed ? "authorized" : "denied",
        payloadHash,
        outcome: policy.allowed ? "authorized" : "denied",
        errorCategory: null,
        metadata: { capability: connector.capability, policyReason: policy.reason },
        occurredAt
      })
    );

    if (!policy.allowed) {
      throw new ConnectorPolicyDeniedError({
        connectorId: connector.connectorId,
        reason: policy.reason
      });
    }

    const context: ConnectorContext = {
      correlationId,
      now: dependencies.now,
      createId: dependencies.createId
    };
    const envelope = connector.capture(request, context);
    const rawListingId = dependencies.createId();
    failureTargetId = rawListingId;
    const capture = RawListingCaptureSchema.parse({
      id: rawListingId,
      source: envelope.source,
      sourceListingId: envelope.sourceListingId,
      sourceUrl: envelope.sourceUrl,
      captureMethod: envelope.captureMethod,
      observedAt: envelope.observedAt,
      sourcePostedAt: envelope.sourcePostedAt,
      rawText: envelope.rawText,
      rawJson: envelope.rawJson,
      captureMetadata: {
        ...envelope.captureMetadata,
        connectorId: envelope.connectorId,
        capability: envelope.capability
      }
    });
    const completedEventId = dependencies.createId();
    const jobId = dependencies.createId();
    const stored = dependencies.repositories.transaction((repositories) => {
      const imported = repositories.rawListings.import(capture);
      const existingSourceRecord = repositories.sourceRecords.getByRawListingId(imported.record.id);
      const queued = existingSourceRecord
        ? null
        : repositories.normalizationJobs.enqueue({
            id: jobId,
            rawListingId: imported.record.id,
            idempotencyKey: sha256Text(`normalization-job:v1:${imported.record.id}`),
            availableAt: occurredAt,
            maxAttempts: 3,
            correlationId,
            causationId: completedEventId,
            createdAt: occurredAt
          }).record;
      const resolvedJob =
        queued ?? repositories.normalizationJobs.getByRawListingId(imported.record.id);

      repositories.activityEvents.append(
        event({
          id: completedEventId,
          correlationId,
          causationId: policyEventId,
          actor: "connector",
          action: "capture.completed",
          targetType: "raw_listing",
          targetId: imported.record.id,
          policyDecision: "authorized",
          payloadHash: imported.record.contentHash,
          outcome: "succeeded",
          errorCategory: null,
          metadata: {
            connectorId: connector.connectorId,
            source: imported.record.source,
            duplicate: !imported.inserted,
            normalizationJobId: resolvedJob?.id ?? null
          },
          occurredAt
        })
      );

      return { imported, existingSourceRecord, job: resolvedJob };
    });
    const result = CaptureResultSchema.parse({
      correlationId,
      rawListingId: stored.imported.record.id,
      contentHash: stored.imported.record.contentHash,
      inserted: stored.imported.inserted,
      duplicate: !stored.imported.inserted,
      normalizationJobId: stored.job?.id ?? null,
      normalizationState: stored.existingSourceRecord
        ? "completed"
        : (stored.job?.state ?? "queued")
    });

    return CaptureAcceptedResponseSchema.parse({
      correlationId: result.correlationId,
      rawListingId: result.rawListingId,
      contentHash: result.contentHash,
      duplicate: result.duplicate,
      normalizationJobId: result.normalizationJobId,
      normalizationState: result.normalizationState
    });
  } catch (error: unknown) {
    const failure = mapFailure(error, correlationId);

    try {
      appendFailure(dependencies.repositories, failure, {
        id: dependencies.createId(),
        causationId: lastEventId,
        targetId: failureTargetId,
        payloadHash,
        policyDecision: failurePolicyDecision,
        occurredAt: safeNow(dependencies)
      });
    } catch {
      // The original safe error remains authoritative when the audit store itself is unavailable.
    }

    throw failure;
  }
}
