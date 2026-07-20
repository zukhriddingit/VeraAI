import {
  NormalizedDecisionSourceSchema,
  type FieldProvenance,
  type JsonValue,
  type ListingSourceRecord,
  type NormalizationReasonCode,
  type NormalizedDecisionSource,
  type PhotoHash,
  type ProvenancedFieldCandidate,
  type RawListing
} from "@vera/domain";

import { normalizeUsAddress } from "./address.ts";
import { normalizeIsoDate } from "./date.ts";
import { normalizeEmail, normalizeUsPhone } from "./phone.ts";
import { canonicalizeListingUrl } from "./url.ts";

export * from "./address.ts";
export * from "./date.ts";
export * from "./money.ts";
export * from "./phone.ts";
export * from "./url.ts";

export interface ContactHasher {
  hash(value: string): string;
}

export interface SuppliedContact {
  readonly kind: "email" | "phone";
  readonly value: string;
}

export interface FieldCandidateInput {
  readonly provenance: FieldProvenance;
  readonly value: JsonValue | null;
}

export interface NormalizeDecisionSourceInput {
  readonly sourceRecord: ListingSourceRecord;
  readonly rawListing: RawListing;
  readonly connectorId: string;
  readonly fieldCandidates: readonly FieldCandidateInput[];
  readonly photoHashes: readonly PhotoHash[];
  readonly contacts: readonly SuppliedContact[];
}

export interface NormalizeDecisionSourceDependencies {
  readonly contactHasher: ContactHasher;
}

function appendReason(reasons: NormalizationReasonCode[], reason: NormalizationReasonCode): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function normalizeContacts(
  contacts: readonly SuppliedContact[],
  hasher: ContactHasher,
  reasons: NormalizationReasonCode[]
): string[] {
  const normalized: string[] = [];
  for (const contact of contacts) {
    if (contact.kind === "email") {
      const email = normalizeEmail(contact.value);
      if (email.status === "known") normalized.push(`email:${email.email}`);
      else appendReason(reasons, "contact_rejected");
    } else {
      const phone = normalizeUsPhone(contact.value);
      if (phone.status === "known") normalized.push(`phone:${phone.e164}`);
      else appendReason(reasons, "contact_rejected");
    }
  }
  if (normalized.length > 0) appendReason(reasons, "contact_normalized");
  return [...new Set(normalized.map((value) => hasher.hash(value)))].sort();
}

function fieldCandidate(input: FieldCandidateInput): ProvenancedFieldCandidate {
  return {
    fieldPath: input.provenance.fieldPath,
    fieldProvenanceId: input.provenance.id,
    sourceRecordId: input.provenance.listingSourceRecordId,
    extractionMethod: input.provenance.extractionMethod,
    valueStatus: input.provenance.valueStatus,
    value: input.provenance.valueStatus === "known" ? input.value : null,
    confidenceBasisPoints: input.provenance.confidenceBasisPoints,
    observedAt: input.provenance.observedAt
  };
}

export function normalizeDecisionSource(
  input: NormalizeDecisionSourceInput,
  dependencies: NormalizeDecisionSourceDependencies
): NormalizedDecisionSource {
  if (input.sourceRecord.rawListingId !== input.rawListing.id) {
    throw new Error("Decision source record does not reference the supplied raw listing.");
  }
  const reasons: NormalizationReasonCode[] = [];
  const address = normalizeUsAddress({ address: input.sourceRecord.address });
  if (address.matchKey !== null) {
    appendReason(reasons, "address_normalized");
    if (address.unit !== null && input.sourceRecord.address.unit === null) {
      appendReason(reasons, "unit_extracted");
    }
    if (address.ambiguous) appendReason(reasons, "address_ambiguous");
  }

  const canonicalUrl =
    input.sourceRecord.sourceUrl === null
      ? null
      : canonicalizeListingUrl(input.sourceRecord.sourceUrl);
  if (canonicalUrl !== null && canonicalUrl.status === "unknown") {
    appendReason(reasons, "url_rejected");
  } else if (canonicalUrl !== null) {
    appendReason(reasons, "url_canonicalized");
  }

  const contactFingerprints = normalizeContacts(
    input.contacts,
    dependencies.contactHasher,
    reasons
  );

  if (
    input.sourceRecord.monthlyRentCents === null ||
    input.sourceRecord.recurringFeesCents === null
  ) {
    appendReason(reasons, "cost_partial");
  } else {
    appendReason(reasons, "money_normalized");
  }
  const availableOn =
    input.sourceRecord.availableOn === null
      ? null
      : normalizeIsoDate(input.sourceRecord.availableOn);
  if (availableOn !== null) appendReason(reasons, "date_normalized");
  if (
    input.sourceRecord.monthlyRentCents === null ||
    availableOn === null ||
    address.matchKey === null
  ) {
    appendReason(reasons, "field_unknown");
  }

  const candidates = input.fieldCandidates
    .map(fieldCandidate)
    .sort((left, right) =>
      left.fieldPath === right.fieldPath
        ? left.fieldProvenanceId.localeCompare(right.fieldProvenanceId, "en")
        : left.fieldPath.localeCompare(right.fieldPath, "en")
    );
  const photoHashes = [...input.photoHashes].sort((left, right) =>
    left.listingPhotoId.localeCompare(right.listingPhotoId, "en")
  );

  return NormalizedDecisionSourceSchema.parse({
    sourceRecordId: input.sourceRecord.id,
    rawListingId: input.rawListing.id,
    source: input.sourceRecord.source,
    connectorId: input.connectorId,
    acquisitionMode: input.rawListing.acquisitionMode,
    sourceListingId: input.sourceRecord.sourceListingId,
    acquiredAt: input.rawListing.createdAt,
    observedAt: input.sourceRecord.observedAt,
    postedAt: input.sourceRecord.sourcePostedAt,
    title: input.sourceRecord.title,
    normalizedAddress: address.line1,
    normalizedUnit: address.unit,
    normalizedCity: address.city,
    normalizedRegion: address.region,
    normalizedPostalCode: address.postalCode,
    normalizedCountryCode: address.countryCode,
    addressMatchKey: address.matchKey,
    latitude: input.sourceRecord.latitude,
    longitude: input.sourceRecord.longitude,
    canonicalUrl: canonicalUrl?.status === "known" ? canonicalUrl.url : null,
    rentCents: input.sourceRecord.monthlyRentCents,
    requiredRecurringFeeCents: input.sourceRecord.recurringFeesCents,
    bedrooms: input.sourceRecord.bedrooms,
    bathrooms: input.sourceRecord.bathrooms,
    squareFeet: input.sourceRecord.squareFeet,
    availableOn,
    descriptionText: input.sourceRecord.description ?? "",
    photoHashes,
    contactFingerprints,
    fieldCandidates: candidates,
    normalizationReasonCodes: reasons
  });
}
