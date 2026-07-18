import type { LLMProvider } from "@vera/ai";
import {
  FieldProvenanceSchema,
  ListingExtractionFieldNameSchema,
  ListingSourceRecordSchema,
  type ExtractedField,
  type ExtractionUnknownReason,
  type FieldExtractionMethod,
  type FieldProvenance,
  type ListingExtractionProviderResult,
  type ListingExtractionRequest
} from "@vera/domain";

import {
  NormalizationResultSchema,
  RawListingEnvelopeSchema,
  type KnownNormalizedField,
  type NormalizationContext,
  type NormalizationResult,
  type NormalizedField,
  type NormalizedListingFields,
  type RawListingEnvelope,
  type UnknownNormalizedField
} from "./contracts.ts";
import {
  extractDeterministicListing,
  type DeterministicListingExtraction
} from "./deterministic-extraction.ts";
import { mergeListingExtraction, type ListingExtractionMergeResult } from "./extraction-merge.ts";
import { buildListingExtractionRequest } from "./extraction-request.ts";
import { buildListingEvidence, type ListingEvidence } from "./listing-evidence.ts";
import { ConnectorCaptureError } from "./errors.ts";

export interface ListingExtractionPipelineInput {
  readonly envelope: RawListingEnvelope;
  readonly provider: LLMProvider | null;
  readonly signal: AbortSignal;
  readonly timeoutMilliseconds: number;
}

export interface ListingExtractionPipelineResult {
  readonly evidence: ListingEvidence;
  readonly deterministic: DeterministicListingExtraction;
  readonly request: ListingExtractionRequest | null;
  readonly providerResult: ListingExtractionProviderResult | null;
  readonly merged: ListingExtractionMergeResult;
}

function oldUnknownReason(
  reason: ExtractionUnknownReason
): UnknownNormalizedField["unknownReason"] {
  return reason === "not_present" ? "missing_evidence" : "unrecognized_format";
}

function legacyField<T>(
  field: ExtractedField<T>,
  extractionMethod: FieldExtractionMethod,
  observedAt: string
): NormalizedField<T> {
  if (field.status === "unknown") {
    return {
      status: "unknown",
      value: null,
      extractionMethod,
      confidenceBasisPoints: 0,
      observedAt,
      unknownReason: oldUnknownReason(field.reason),
      evidenceExcerpt: null
    };
  }
  return {
    status: "known",
    value: field.value,
    extractionMethod,
    confidenceBasisPoints: field.confidenceBasisPoints,
    observedAt,
    evidenceExcerpt: field.evidenceSnippet
  };
}

function knownLegacy<T>(
  value: T,
  extractionMethod: FieldExtractionMethod,
  observedAt: string,
  evidenceExcerpt: string | null
): KnownNormalizedField<T> {
  return {
    status: "known",
    value,
    extractionMethod,
    confidenceBasisPoints: 10_000,
    observedAt,
    evidenceExcerpt
  };
}

function unknownLegacy(
  extractionMethod: FieldExtractionMethod,
  observedAt: string,
  reason: UnknownNormalizedField["unknownReason"]
): UnknownNormalizedField {
  return {
    status: "unknown",
    value: null,
    extractionMethod,
    confidenceBasisPoints: 0,
    observedAt,
    unknownReason: reason,
    evidenceExcerpt: null
  };
}

function sourceMethod(envelope: RawListingEnvelope): Exclude<FieldExtractionMethod, "ai"> {
  if (envelope.captureMethod === "fixture") return "fixture_structured";
  if (envelope.captureMethod === "manual_structured") return "manual";
  return "rule";
}

function projectedMonthlyRent(
  merged: ListingExtractionMergeResult,
  observedAt: string
): NormalizedField<number> {
  const field = merged.extraction.baseRent;
  const method = merged.extractionMethods.baseRent;
  if (
    field.status === "known" &&
    field.value.currency === "USD" &&
    field.value.billingPeriod === "month"
  ) {
    return {
      status: "known",
      value: field.value.amountMinorUnits,
      extractionMethod: method,
      confidenceBasisPoints: field.confidenceBasisPoints,
      observedAt,
      evidenceExcerpt: field.evidenceSnippet
    };
  }
  return unknownLegacy(
    method,
    observedAt,
    field.status === "unknown" ? oldUnknownReason(field.reason) : "unrecognized_format"
  );
}

function recurringFeeAggregate(merged: ListingExtractionMergeResult): number | null {
  const field = merged.extraction.requiredRecurringFees;
  if (field.status === "unknown") return null;
  if (
    field.value.some((fee) => fee.amount.currency !== "USD" || fee.amount.billingPeriod !== "month")
  ) {
    return null;
  }
  const aggregate = field.value.reduce((sum, fee) => sum + fee.amount.amountMinorUnits, 0);
  return Number.isSafeInteger(aggregate) ? aggregate : null;
}

function buildLegacyFields(
  envelope: RawListingEnvelope,
  merged: ListingExtractionMergeResult
): NormalizedListingFields {
  const observedAt = envelope.observedAt;
  const method = sourceMethod(envelope);
  return {
    title: legacyField(merged.extraction.title, merged.extractionMethods.title, observedAt),
    url:
      envelope.sourceUrl === null
        ? unknownLegacy(method, observedAt, "missing_evidence")
        : knownLegacy(envelope.sourceUrl, method, observedAt, null),
    source: knownLegacy(
      envelope.source,
      method,
      observedAt,
      "Source label validated during capture."
    ),
    monthlyRentCents: projectedMonthlyRent(merged, observedAt),
    bedrooms: legacyField(
      merged.extraction.bedrooms,
      merged.extractionMethods.bedrooms,
      observedAt
    ),
    bathrooms: legacyField(
      merged.extraction.bathrooms,
      merged.extractionMethods.bathrooms,
      observedAt
    ),
    addressText: legacyField(
      merged.extraction.addressText,
      merged.extractionMethods.addressText,
      observedAt
    ),
    sourcePostedAt: legacyField(
      merged.extraction.sourcePostedAt,
      merged.extractionMethods.sourcePostedAt,
      observedAt
    ),
    contactChannel: legacyField(
      merged.extraction.contactChannel,
      merged.extractionMethods.contactChannel,
      observedAt
    )
  };
}

function extractionProvenance(
  merged: ListingExtractionMergeResult,
  sourceRecordId: string,
  rawListingId: string,
  observedAt: string,
  createId: () => string
): FieldProvenance[] {
  return ListingExtractionFieldNameSchema.options.map((fieldPath) => {
    const field = merged.extraction[fieldPath];
    return FieldProvenanceSchema.parse({
      id: createId(),
      listingSourceRecordId: sourceRecordId,
      rawListingId,
      fieldPath,
      extractionMethod: merged.extractionMethods[fieldPath],
      confidenceBasisPoints: field.confidenceBasisPoints,
      valueStatus: field.status,
      unknownReason: field.status === "unknown" ? oldUnknownReason(field.reason) : null,
      observedAt,
      evidenceExcerpt: field.evidenceSnippet
    });
  });
}

function captureProvenance(
  envelope: RawListingEnvelope,
  sourceRecordId: string,
  rawListingId: string,
  createId: () => string
): FieldProvenance[] {
  const method = sourceMethod(envelope);
  const sourceUrl = FieldProvenanceSchema.parse({
    id: createId(),
    listingSourceRecordId: sourceRecordId,
    rawListingId,
    fieldPath: "sourceUrl",
    extractionMethod: method,
    confidenceBasisPoints: envelope.sourceUrl === null ? 0 : 10_000,
    valueStatus: envelope.sourceUrl === null ? "unknown" : "known",
    unknownReason: envelope.sourceUrl === null ? "missing_evidence" : null,
    observedAt: envelope.observedAt,
    evidenceExcerpt: null
  });
  const source = FieldProvenanceSchema.parse({
    id: createId(),
    listingSourceRecordId: sourceRecordId,
    rawListingId,
    fieldPath: "source",
    extractionMethod: method,
    confidenceBasisPoints: 10_000,
    valueStatus: "known",
    unknownReason: null,
    observedAt: envelope.observedAt,
    evidenceExcerpt: "Source label validated during capture."
  });
  return [sourceUrl, source];
}

export async function runListingExtractionPipeline(
  input: ListingExtractionPipelineInput
): Promise<ListingExtractionPipelineResult> {
  const envelope = RawListingEnvelopeSchema.parse(input.envelope);
  const evidence = buildListingEvidence(envelope);
  const deterministic = extractDeterministicListing(envelope);
  const request = buildListingExtractionRequest(evidence, deterministic);
  const providerResult =
    request === null || input.provider === null
      ? null
      : await input.provider.extract(request, {
          signal: input.signal,
          timeoutMilliseconds: input.timeoutMilliseconds
        });
  const merged = mergeListingExtraction({ deterministic, request, providerResult });
  return { evidence, deterministic, request, providerResult, merged };
}

export function projectListingExtraction(
  inputEnvelope: RawListingEnvelope,
  merged: ListingExtractionMergeResult,
  context: NormalizationContext
): NormalizationResult {
  const envelope = RawListingEnvelopeSchema.parse(inputEnvelope);
  const createdAtDate = context.now();
  if (Number.isNaN(createdAtDate.getTime())) {
    throw new ConnectorCaptureError({
      connectorId: envelope.connectorId,
      reason: "invalid_clock_value"
    });
  }
  const sourceRecordId = context.createId();
  const extractionFields = ListingExtractionFieldNameSchema.options.map(
    (field) => merged.extraction[field]
  );
  const knownFields = extractionFields.filter((field) => field.status === "known");
  const completenessBasisPoints = Math.round(
    (knownFields.length / ListingExtractionFieldNameSchema.options.length) * 10_000
  );
  const extractionConfidenceBasisPoints =
    knownFields.length === 0
      ? 0
      : Math.round(
          knownFields.reduce((total, field) => total + field.confidenceBasisPoints, 0) /
            knownFields.length
        );
  const extraction = merged.extraction;
  const cats =
    extraction.catsAllowed.status === "known"
      ? extraction.catsAllowed.value
        ? "allowed"
        : "not_allowed"
      : "unknown";
  const dogs =
    extraction.dogsAllowed.status === "known"
      ? extraction.dogsAllowed.value
        ? "allowed"
        : "not_allowed"
      : "unknown";
  const sourceRecord = ListingSourceRecordSchema.parse({
    id: sourceRecordId,
    rawListingId: context.rawListingId,
    source: envelope.source,
    sourceListingId: envelope.sourceListingId,
    sourceUrl: envelope.sourceUrl,
    sourcePostedAt:
      extraction.sourcePostedAt.status === "known" ? extraction.sourcePostedAt.value : null,
    contactChannel:
      extraction.contactChannel.status === "known" ? extraction.contactChannel.value : "unknown",
    title: extraction.title.status === "known" ? extraction.title.value : "Captured listing",
    address: {
      line1: extraction.addressText.status === "known" ? extraction.addressText.value : null,
      unit: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null
    },
    monthlyRentCents:
      extraction.baseRent.status === "known" &&
      extraction.baseRent.value.currency === "USD" &&
      extraction.baseRent.value.billingPeriod === "month"
        ? extraction.baseRent.value.amountMinorUnits
        : null,
    recurringFeesCents: recurringFeeAggregate(merged),
    bedrooms: extraction.bedrooms.status === "known" ? extraction.bedrooms.value : null,
    bathrooms: extraction.bathrooms.status === "known" ? extraction.bathrooms.value : null,
    squareFeet: extraction.squareFeet.status === "known" ? extraction.squareFeet.value : null,
    propertyType: extraction.propertyType.status === "known" ? extraction.propertyType.value : null,
    availableOn: extraction.availableOn.status === "known" ? extraction.availableOn.value : null,
    leaseTermMonths:
      extraction.leaseTermMonths.status === "known" ? extraction.leaseTermMonths.value : null,
    petPolicy:
      extraction.catsAllowed.status === "unknown" && extraction.dogsAllowed.status === "unknown"
        ? null
        : { cats, dogs, notes: null },
    amenities: extraction.amenities.status === "known" ? extraction.amenities.value : [],
    description: null,
    extractionConfidenceBasisPoints,
    completenessBasisPoints,
    observedAt: envelope.observedAt,
    createdAt: createdAtDate.toISOString()
  });
  const fields = buildLegacyFields(envelope, merged);
  const provenance = [
    ...extractionProvenance(merged, sourceRecordId, context.rawListingId, envelope.observedAt, () =>
      context.createId()
    ),
    ...captureProvenance(envelope, sourceRecordId, context.rawListingId, () => context.createId())
  ];
  return NormalizationResultSchema.parse({
    sourceRecord,
    fields,
    extraction,
    extractionMethods: merged.extractionMethods,
    provenance
  });
}

export function normalizeRawListing(
  inputEnvelope: RawListingEnvelope,
  context: NormalizationContext
): NormalizationResult {
  const envelope = RawListingEnvelopeSchema.parse(inputEnvelope);
  const deterministic = extractDeterministicListing(envelope);
  const merged = mergeListingExtraction({
    deterministic,
    request: null,
    providerResult: null
  });
  return projectListingExtraction(envelope, merged, context);
}
