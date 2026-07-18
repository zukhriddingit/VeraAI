import { createHash } from "node:crypto";

import {
  AcquisitionModeSchema,
  acquisitionModeForListingCaptureMethod,
  ConfidenceBasisPointsSchema,
  ContactChannelSchema,
  ConnectorCursorSchema,
  ConnectorStatusSchema,
  EntityIdSchema,
  FieldExtractionMethodSchema,
  FieldProvenanceSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  ListingCaptureMethodSchema,
  ListingExtractionFieldNameSchema,
  ListingExtractionSchema,
  ListingSourceLabelSchema,
  ListingSourceRecordSchema,
  MoneyCentsSchema,
  NormalizationJobStateSchema,
  RawListingJsonEvidenceSchema,
  Sha256Schema,
  SourceCapabilitySchema,
  UnknownFieldReasonSchema,
  type AcquisitionMode,
  type ContactChannel,
  type ConnectorCursor,
  type ConnectorStatus,
  type FieldExtractionMethod,
  type FieldProvenance,
  type ListingCaptureMethod,
  type JsonValue,
  type ListingExtraction,
  type ListingExtractionFieldName,
  type ListingSourceLabel,
  type ListingSourceRecord,
  type NormalizationJobState,
  type SourceCapability,
  type UnknownFieldReason
} from "@vera/domain";
import type { SourcePolicyRegistry } from "@vera/policy";
import { z } from "zod";

import { isConnectorError } from "./errors.ts";

export const STRUCTURED_LISTING_MAX_TITLE_LENGTH = 300;
export const CAPTURE_TEXT_MAX_LENGTH = 250_000;
export { RAW_LISTING_JSON_MAX_BYTES } from "@vera/domain";

export const StructuredMoneyObservationSchema = z
  .object({
    amountMinorUnits: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    billingPeriod: z.enum(["day", "week", "month", "year"]),
    rawAmount: z.string().trim().min(1).max(200)
  })
  .strict();

export const StructuredRequiredRecurringFeeSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    amount: StructuredMoneyObservationSchema
  })
  .strict();

const StructuredRequiredRecurringFeesSchema = z
  .array(StructuredRequiredRecurringFeeSchema)
  .max(100)
  .superRefine((fees, context) => {
    const labels = fees.map((fee) => fee.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: "custom",
        message: "Recurring-fee labels must be unique."
      });
    }
  });

export const StructuredListingInputSchema = z
  .object({
    source: ListingSourceLabelSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullish(),
    title: z.string().trim().min(1).max(STRUCTURED_LISTING_MAX_TITLE_LENGTH).nullish(),
    url: z.string().trim().min(1).max(2_048).nullish(),
    monthlyRentCents: MoneyCentsSchema.nullish(),
    bedrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullish(),
    bathrooms: z.number().nonnegative().max(50).multipleOf(0.5).nullish(),
    addressText: z.string().trim().min(1).max(300).nullish(),
    squareFeet: z.number().int().positive().max(1_000_000).nullish(),
    propertyType: z.enum(["apartment", "condo", "house", "townhouse", "room", "other"]).nullish(),
    baseRent: StructuredMoneyObservationSchema.nullish(),
    requiredRecurringFees: StructuredRequiredRecurringFeesSchema.nullish(),
    availabilityRaw: z.string().trim().min(1).max(300).nullish(),
    availableOn: IsoDateSchema.nullish(),
    leaseTermMonths: z.number().int().positive().max(120).nullish(),
    catsAllowed: z.boolean().nullish(),
    dogsAllowed: z.boolean().nullish(),
    amenities: z.array(z.string().trim().min(1).max(120)).max(200).nullish(),
    sourcePostedAt: IsoDateTimeSchema.nullish(),
    contactChannel: ContactChannelSchema.nullish(),
    contactName: z.string().trim().min(1).max(200).nullish(),
    contactEmail: z.email().max(320).nullish(),
    contactPhone: z
      .string()
      .trim()
      .min(7)
      .max(80)
      .regex(/^\+?[0-9][0-9().\s-]*[0-9]$/u)
      .nullish(),
    contactUrl: z
      .string()
      .url()
      .max(2_048)
      .regex(/^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?][^\s#]*)?$/u)
      .nullish()
  })
  .strict();

export type StructuredListingInput = z.infer<typeof StructuredListingInputSchema>;

export const FixtureCaptureRequestSchema = z
  .object({
    kind: z.literal("fixture"),
    sanitized: z.literal(true),
    listing: StructuredListingInputSchema
  })
  .strict();

export const ManualTextCaptureRequestSchema = z
  .object({
    kind: z.literal("manual_text"),
    sourceUrl: z.string().trim().min(1).max(2_048),
    listingText: z.string().min(1).max(CAPTURE_TEXT_MAX_LENGTH)
  })
  .strict();

export const ManualStructuredCaptureRequestSchema = z
  .object({
    kind: z.literal("manual_structured"),
    sourceUrl: z.string().trim().min(1).max(2_048).optional(),
    listing: StructuredListingInputSchema
  })
  .strict();

export const CaptureRequestSchema = z.discriminatedUnion("kind", [
  FixtureCaptureRequestSchema,
  ManualTextCaptureRequestSchema,
  ManualStructuredCaptureRequestSchema
]);

export type FixtureCaptureRequest = z.infer<typeof FixtureCaptureRequestSchema>;
export type ManualTextCaptureRequest = z.infer<typeof ManualTextCaptureRequestSchema>;
export type ManualStructuredCaptureRequest = z.infer<typeof ManualStructuredCaptureRequestSchema>;
export type ManualCaptureRequest = ManualTextCaptureRequest | ManualStructuredCaptureRequest;
export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const ConnectorOperationSchema = z.enum(["discover", "capture", "fetch_detail"]);

export const SourcePolicyRequirementSchema = z
  .object({
    connectorId: EntityIdSchema,
    acquisitionMode: AcquisitionModeSchema,
    capability: SourceCapabilitySchema,
    operation: z.string().trim().min(1).max(160)
  })
  .strict();

export const ConnectorDiscoveryRequestSchema = z
  .object({
    sourceConfigurationId: EntityIdSchema,
    cursor: ConnectorCursorSchema.nullable()
  })
  .strict();

export const ConnectorFetchDetailRequestSchema = z
  .object({
    sourceListingId: z.string().trim().min(1).max(200)
  })
  .strict();

export const ConnectorOperationExecutionRequestSchema = z
  .object({
    operation: ConnectorOperationSchema,
    correlationId: EntityIdSchema,
    payloadHash: Sha256Schema,
    idempotencyKey: Sha256Schema,
    completedAt: IsoDateTimeSchema
  })
  .strict();

export type ConnectorOperation = z.infer<typeof ConnectorOperationSchema>;
export type SourcePolicyRequirement = z.infer<typeof SourcePolicyRequirementSchema>;
export type ConnectorDiscoveryRequest = z.infer<typeof ConnectorDiscoveryRequestSchema>;
export type ConnectorFetchDetailRequest = z.infer<typeof ConnectorFetchDetailRequestSchema>;
export type ConnectorOperationExecutionRequest = z.infer<
  typeof ConnectorOperationExecutionRequestSchema
>;

export const BrowserAccessDispositionSchema = z.enum([
  "policy_entry_present",
  "manual_policy_required",
  "not_applicable"
]);

export type BrowserAccessDisposition = z.infer<typeof BrowserAccessDispositionSchema>;

export const CaptureMetadataSchema = z
  .object({
    networkAccess: z.boolean(),
    untrustedContent: z.literal(true),
    browserAccess: BrowserAccessDispositionSchema
  })
  .strict();

export interface RawListingEnvelope {
  readonly connectorId: string;
  readonly capability: SourceCapability;
  readonly acquisitionMode: AcquisitionMode;
  readonly source: ListingSourceLabel;
  readonly sourceListingId: string | null;
  readonly sourceUrl: string | null;
  readonly captureMethod: ListingCaptureMethod;
  readonly observedAt: string;
  readonly sourcePostedAt: string | null;
  readonly rawText: string | null;
  readonly rawJson: JsonValue | null;
  readonly captureMetadata: {
    readonly networkAccess: boolean;
    readonly untrustedContent: true;
    readonly browserAccess: BrowserAccessDisposition;
  };
}

export const RawListingEnvelopeSchema: z.ZodType<RawListingEnvelope> = z
  .object({
    connectorId: EntityIdSchema,
    capability: SourceCapabilitySchema,
    acquisitionMode: AcquisitionModeSchema,
    source: ListingSourceLabelSchema,
    sourceListingId: z.string().trim().min(1).max(200).nullable(),
    sourceUrl: z.string().url().max(2_048).nullable(),
    captureMethod: ListingCaptureMethodSchema,
    observedAt: IsoDateTimeSchema,
    sourcePostedAt: IsoDateTimeSchema.nullable(),
    rawText: z.string().min(1).max(CAPTURE_TEXT_MAX_LENGTH).nullable(),
    rawJson: RawListingJsonEvidenceSchema.nullable(),
    captureMetadata: CaptureMetadataSchema
  })
  .strict()
  .superRefine((envelope, context) => {
    if (envelope.rawText === null && envelope.rawJson === null) {
      context.addIssue({
        code: "custom",
        path: ["rawText"],
        message: "A raw listing envelope requires text or structured evidence."
      });
    }
    const expectedMode = acquisitionModeForListingCaptureMethod(envelope.captureMethod);
    if (envelope.acquisitionMode !== expectedMode) {
      context.addIssue({
        code: "custom",
        path: ["acquisitionMode"],
        message: "Raw envelope acquisition mode must match its capture method."
      });
    }

    const expectedCapability = {
      fixture: "fixture.read",
      user_capture: "manual.capture",
      official_api: "structured_feed.read",
      email_alert: "gmail.alert.read",
      local_browser: "browser.capture"
    } as const;
    if (envelope.capability !== expectedCapability[envelope.acquisitionMode]) {
      context.addIssue({
        code: "custom",
        path: ["capability"],
        message: "Raw envelope capability must match its acquisition mode."
      });
    }

    const expectedNetworkAccess = !["fixture", "user_capture"].includes(envelope.acquisitionMode);
    if (envelope.captureMetadata.networkAccess !== expectedNetworkAccess) {
      context.addIssue({
        code: "custom",
        path: ["captureMetadata", "networkAccess"],
        message: "Raw envelope network metadata must match its acquisition mode."
      });
    }

    if (
      envelope.acquisitionMode === "local_browser" &&
      envelope.captureMetadata.browserAccess !== "policy_entry_present"
    ) {
      context.addIssue({
        code: "custom",
        path: ["captureMetadata", "browserAccess"],
        message: "Local-browser evidence requires an explicit browser policy entry."
      });
    }
  });

export const ConnectorOperationFailureCodeSchema = z.enum([
  "malformed_payload",
  "unsupported_connector",
  "unsupported_source",
  "invalid_url",
  "policy_denied",
  "capture_failed",
  "invalid_execution_context",
  "invalid_connector_output",
  "unexpected_connector_failure"
]);

export const ConnectorOperationFailureSchema = z
  .object({
    code: ConnectorOperationFailureCodeSchema,
    category: z.enum(["request_validation", "configuration", "policy", "connector", "internal"]),
    retryable: z.boolean(),
    recoveryAction: z.enum([
      "correct_request",
      "select_supported_connector",
      "review_source_policy",
      "inspect_connector"
    ]),
    reasonCode: EntityIdSchema.nullable()
  })
  .strict();

export type ConnectorOperationFailure = z.infer<typeof ConnectorOperationFailureSchema>;

export const ConnectorOperationResultSchema = z
  .object({
    connectorId: EntityIdSchema,
    source: ListingSourceLabelSchema,
    acquisitionMode: AcquisitionModeSchema,
    operation: ConnectorOperationSchema,
    status: z.enum(["completed", "unsupported_operation", "failed"]),
    correlationId: EntityIdSchema,
    payloadHash: Sha256Schema,
    idempotencyKey: Sha256Schema,
    resultHash: Sha256Schema,
    records: z.array(RawListingEnvelopeSchema).max(200),
    recordCount: z.number().int().nonnegative().max(200),
    previousCursor: ConnectorCursorSchema.nullable(),
    cursorCandidate: ConnectorCursorSchema.nullable(),
    completedAt: IsoDateTimeSchema,
    untrustedInput: z.literal(true),
    failure: ConnectorOperationFailureSchema.nullable()
  })
  .strict()
  .superRefine((result, context) => {
    if (result.recordCount !== result.records.length) {
      context.addIssue({
        code: "custom",
        path: ["recordCount"],
        message: "Connector result count must match its records."
      });
    }
    if (
      result.records.some(
        (record) =>
          record.connectorId !== result.connectorId ||
          record.acquisitionMode !== result.acquisitionMode
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["records"],
        message: "Connector result records must retain connector and acquisition-mode identity."
      });
    }
    if (
      result.status !== "completed" &&
      (result.records.length > 0 || result.cursorCandidate !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["records"],
        message: "Non-success connector results cannot contain records or a cursor candidate."
      });
    }
    if (result.status === "failed" && result.failure === null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Failed connector results require typed failure and recovery metadata."
      });
    }
    if (result.status !== "failed" && result.failure !== null) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Only failed connector results may carry failure metadata."
      });
    }
  });

export type ConnectorOperationResult = z.infer<typeof ConnectorOperationResultSchema>;

export const NormalizationStateSchema = NormalizationJobStateSchema;

export type NormalizationState = NormalizationJobState;

export interface CaptureResult {
  readonly correlationId: string;
  readonly rawListingId: string;
  readonly contentHash: string;
  readonly inserted: boolean;
  readonly duplicate: boolean;
  readonly normalizationJobId: string | null;
  readonly normalizationState: NormalizationState;
}

export const CaptureResultSchema: z.ZodType<CaptureResult> = z
  .object({
    correlationId: EntityIdSchema,
    rawListingId: EntityIdSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    inserted: z.boolean(),
    duplicate: z.boolean(),
    normalizationJobId: EntityIdSchema.nullable(),
    normalizationState: NormalizationStateSchema
  })
  .strict()
  .superRefine((result, context) => {
    if (result.inserted === result.duplicate) {
      context.addIssue({
        code: "custom",
        path: ["duplicate"],
        message: "Inserted and duplicate must be logical opposites."
      });
    }
  });

export const ConnectorHealthSchema = ConnectorStatusSchema;

export type ConnectorHealth = ConnectorStatus;

export interface ConnectorContext {
  readonly correlationId: string;
  now(): Date;
  createId(): string;
}

export interface ConnectorOperationExecutionContext {
  readonly connectorContext: ConnectorContext;
  readonly discoveryRequest?: ConnectorDiscoveryRequest;
  readonly captureRequest?: CaptureRequest;
  readonly fetchDetailRequest?: ConnectorFetchDetailRequest;
}

export interface SourceConnector {
  readonly connectorId: string;
  readonly displayName: string;
  readonly source: ListingSourceLabel;
  readonly acquisitionMode: AcquisitionMode;
  readonly capability: SourceCapability;
  readonly policyRequirement: SourcePolicyRequirement;
  readonly operations: readonly ConnectorOperation[];
  readonly cursorState: ConnectorCursor | null;
  discover?(
    request: ConnectorDiscoveryRequest,
    context: ConnectorContext
  ): Promise<readonly RawListingEnvelope[]>;
  capture?(
    request: CaptureRequest,
    context: ConnectorContext
  ): RawListingEnvelope | Promise<RawListingEnvelope>;
  fetchDetail?(
    request: ConnectorFetchDetailRequest,
    context: ConnectorContext
  ): Promise<RawListingEnvelope>;
  health(registry: SourcePolicyRegistry): ConnectorHealth;
}

export interface CaptureSourceConnector<
  Request extends CaptureRequest = CaptureRequest
> extends SourceConnector {
  supports(request: CaptureRequest): request is Request;
  capture(request: Request, context: ConnectorContext): RawListingEnvelope;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === "object") {
    const source = value as Readonly<Record<string, unknown>>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) result[key] = canonicalize(entry);
    }
    return result;
  }
  throw new TypeError("Connector result hashing accepts only JSON-compatible values.");
}

function resultHash(body: Readonly<Record<string, unknown>>): string {
  return createHash("sha256")
    .update(`connector-operation-result:v1:${JSON.stringify(canonicalize(body))}`, "utf8")
    .digest("hex");
}

function operationImplemented(connector: SourceConnector, operation: ConnectorOperation): boolean {
  switch (operation) {
    case "discover":
      return connector.discover !== undefined;
    case "capture":
      return connector.capture !== undefined;
    case "fetch_detail":
      return connector.fetchDetail !== undefined;
  }
}

function operationResult(
  connector: SourceConnector,
  request: ConnectorOperationExecutionRequest,
  status: ConnectorOperationResult["status"],
  records: readonly RawListingEnvelope[],
  previousCursor: ConnectorCursor | null,
  cursorCandidate: ConnectorCursor | null,
  failure: ConnectorOperationFailure | null = null
): ConnectorOperationResult {
  const body = {
    connectorId: connector.connectorId,
    source: connector.source,
    acquisitionMode: connector.acquisitionMode,
    operation: request.operation,
    status,
    correlationId: request.correlationId,
    payloadHash: request.payloadHash,
    idempotencyKey: request.idempotencyKey,
    records: records.map((record) => RawListingEnvelopeSchema.parse(record)),
    recordCount: records.length,
    previousCursor,
    cursorCandidate,
    completedAt: request.completedAt,
    untrustedInput: true as const,
    failure
  };
  return ConnectorOperationResultSchema.parse({ ...body, resultHash: resultHash(body) });
}

class InvalidConnectorExecutionContextError extends Error {}

function invalidExecutionContext(): ConnectorOperationFailure {
  return ConnectorOperationFailureSchema.parse({
    code: "invalid_execution_context",
    category: "request_validation",
    retryable: false,
    recoveryAction: "correct_request",
    reasonCode: null
  });
}

function invalidConnectorOutput(): ConnectorOperationFailure {
  return ConnectorOperationFailureSchema.parse({
    code: "invalid_connector_output",
    category: "connector",
    retryable: false,
    recoveryAction: "inspect_connector",
    reasonCode: "schema_validation_failed"
  });
}

function typedConnectorFailure(error: unknown): ConnectorOperationFailure {
  if (error instanceof InvalidConnectorExecutionContextError) return invalidExecutionContext();

  if (isConnectorError(error)) {
    const reasonCode = EntityIdSchema.safeParse(error.safeDetails.reason);
    switch (error.code) {
      case "malformed_payload":
      case "unsupported_source":
      case "invalid_url":
        return ConnectorOperationFailureSchema.parse({
          code: error.code,
          category: "request_validation",
          retryable: false,
          recoveryAction: "correct_request",
          reasonCode: reasonCode.success ? reasonCode.data : null
        });
      case "unsupported_connector":
        return ConnectorOperationFailureSchema.parse({
          code: error.code,
          category: "configuration",
          retryable: false,
          recoveryAction: "select_supported_connector",
          reasonCode: reasonCode.success ? reasonCode.data : null
        });
      case "policy_denied":
        return ConnectorOperationFailureSchema.parse({
          code: error.code,
          category: "policy",
          retryable: false,
          recoveryAction: "review_source_policy",
          reasonCode: reasonCode.success ? reasonCode.data : null
        });
      case "capture_failed":
        return ConnectorOperationFailureSchema.parse({
          code: error.code,
          category: "connector",
          retryable: false,
          recoveryAction: "inspect_connector",
          reasonCode: reasonCode.success ? reasonCode.data : null
        });
    }
  }

  if (error instanceof z.ZodError) {
    return invalidConnectorOutput();
  }

  return ConnectorOperationFailureSchema.parse({
    code: "unexpected_connector_failure",
    category: "internal",
    retryable: false,
    recoveryAction: "inspect_connector",
    reasonCode: null
  });
}

function requireExecutionContext<T>(input: T | undefined, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new InvalidConnectorExecutionContextError();
  return parsed.data;
}

export async function executeConnectorOperation(
  connector: SourceConnector,
  requestInput: ConnectorOperationExecutionRequest,
  context?: ConnectorOperationExecutionContext
): Promise<ConnectorOperationResult> {
  const request = ConnectorOperationExecutionRequestSchema.parse(requestInput);
  const parsedPreviousCursor = ConnectorCursorSchema.nullable().safeParse(connector.cursorState);
  if (!parsedPreviousCursor.success) {
    return operationResult(connector, request, "failed", [], null, null, invalidConnectorOutput());
  }
  const previousCursor = parsedPreviousCursor.data;
  if (
    !connector.operations.includes(request.operation) ||
    !operationImplemented(connector, request.operation)
  ) {
    return operationResult(connector, request, "unsupported_operation", [], previousCursor, null);
  }

  try {
    if (
      context === undefined ||
      context.connectorContext === undefined ||
      context.connectorContext.correlationId !== request.correlationId ||
      typeof context.connectorContext.now !== "function" ||
      typeof context.connectorContext.createId !== "function"
    ) {
      throw new InvalidConnectorExecutionContextError();
    }

    let records: readonly RawListingEnvelope[];
    switch (request.operation) {
      case "discover": {
        if (connector.discover === undefined) throw new InvalidConnectorExecutionContextError();
        const discovery = requireExecutionContext(
          context.discoveryRequest,
          ConnectorDiscoveryRequestSchema
        );
        records = await connector.discover(discovery, context.connectorContext);
        break;
      }
      case "capture": {
        if (connector.capture === undefined) throw new InvalidConnectorExecutionContextError();
        const capture = requireExecutionContext(context.captureRequest, CaptureRequestSchema);
        records = [await connector.capture(capture, context.connectorContext)];
        break;
      }
      case "fetch_detail": {
        if (connector.fetchDetail === undefined) throw new InvalidConnectorExecutionContextError();
        const detail = requireExecutionContext(
          context.fetchDetailRequest,
          ConnectorFetchDetailRequestSchema
        );
        records = [await connector.fetchDetail(detail, context.connectorContext)];
        break;
      }
    }

    const cursorCandidate = connector.cursorState;
    return operationResult(
      connector,
      request,
      "completed",
      records,
      previousCursor,
      cursorCandidate === null ? null : ConnectorCursorSchema.parse(cursorCandidate)
    );
  } catch (error) {
    return operationResult(
      connector,
      request,
      "failed",
      [],
      previousCursor,
      null,
      typedConnectorFailure(error)
    );
  }
}

export interface KnownNormalizedField<T> {
  readonly status: "known";
  readonly value: T;
  readonly extractionMethod: FieldExtractionMethod;
  readonly confidenceBasisPoints: number;
  readonly observedAt: string;
  readonly evidenceExcerpt: string | null;
}

export interface UnknownNormalizedField {
  readonly status: "unknown";
  readonly value: null;
  readonly extractionMethod: FieldExtractionMethod;
  readonly confidenceBasisPoints: 0;
  readonly observedAt: string;
  readonly unknownReason: UnknownFieldReason;
  readonly evidenceExcerpt: null;
}

export type NormalizedField<T> = KnownNormalizedField<T> | UnknownNormalizedField;

export interface NormalizedListingFields {
  readonly title: NormalizedField<string>;
  readonly url: NormalizedField<string>;
  readonly source: NormalizedField<ListingSourceLabel>;
  readonly monthlyRentCents: NormalizedField<number>;
  readonly bedrooms: NormalizedField<number>;
  readonly bathrooms: NormalizedField<number>;
  readonly addressText: NormalizedField<string>;
  readonly sourcePostedAt: NormalizedField<string>;
  readonly contactChannel: NormalizedField<ContactChannel>;
}

const UnknownNormalizedFieldSchema = z
  .object({
    status: z.literal("unknown"),
    value: z.null(),
    extractionMethod: z.enum(["fixture_structured", "manual", "rule", "ai"]),
    confidenceBasisPoints: z.literal(0),
    observedAt: IsoDateTimeSchema,
    unknownReason: UnknownFieldReasonSchema,
    evidenceExcerpt: z.null()
  })
  .strict();

function normalizedFieldSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("known"),
        value: valueSchema,
        extractionMethod: z.enum(["fixture_structured", "manual", "rule", "ai"]),
        confidenceBasisPoints: ConfidenceBasisPointsSchema.refine((value) => value > 0),
        observedAt: IsoDateTimeSchema,
        evidenceExcerpt: z.string().trim().min(1).max(1_000).nullable()
      })
      .strict(),
    UnknownNormalizedFieldSchema
  ]);
}

export const NormalizedListingFieldsSchema = z
  .object({
    title: normalizedFieldSchema(z.string().trim().min(1).max(300)),
    url: normalizedFieldSchema(z.string().url().max(2_048)),
    source: normalizedFieldSchema(ListingSourceLabelSchema),
    monthlyRentCents: normalizedFieldSchema(MoneyCentsSchema),
    bedrooms: normalizedFieldSchema(z.number().nonnegative().max(50).multipleOf(0.5)),
    bathrooms: normalizedFieldSchema(z.number().nonnegative().max(50).multipleOf(0.5)),
    addressText: normalizedFieldSchema(z.string().trim().min(1).max(300)),
    sourcePostedAt: normalizedFieldSchema(IsoDateTimeSchema),
    contactChannel: normalizedFieldSchema(ContactChannelSchema)
  })
  .strict();

export interface NormalizationResult {
  readonly sourceRecord: ListingSourceRecord;
  readonly fields: NormalizedListingFields;
  readonly extraction: ListingExtraction;
  readonly extractionMethods: Readonly<Record<ListingExtractionFieldName, FieldExtractionMethod>>;
  readonly provenance: readonly FieldProvenance[];
}

export const ExtractionMethodMapSchema = z.record(
  ListingExtractionFieldNameSchema,
  FieldExtractionMethodSchema
);

export const NormalizationResultSchema: z.ZodType<NormalizationResult> = z
  .object({
    sourceRecord: ListingSourceRecordSchema,
    fields: NormalizedListingFieldsSchema,
    extraction: ListingExtractionSchema,
    extractionMethods: ExtractionMethodMapSchema,
    provenance: z.array(FieldProvenanceSchema).length(22)
  })
  .strict();

export interface NormalizationContext {
  readonly rawListingId: string;
  createId(): string;
  now(): Date;
}

export type ConnectorCapability = Extract<SourceCapability, "fixture.read" | "manual.capture">;
