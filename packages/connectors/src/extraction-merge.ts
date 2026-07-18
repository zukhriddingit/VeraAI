import { validateExtractionEvidence, type ExtractionValidationIssue } from "@vera/ai";
import {
  ListingExtractionFieldNameSchema,
  ListingExtractionProviderResultSchema,
  ListingExtractionSchema,
  type FieldExtractionMethod,
  type ListingExtraction,
  type ListingExtractionFieldName,
  type ListingExtractionProviderResult,
  type ListingExtractionRequest
} from "@vera/domain";

import type { DeterministicListingExtraction } from "./deterministic-extraction.ts";

export interface ListingExtractionMergeInput {
  readonly deterministic: DeterministicListingExtraction;
  readonly request: ListingExtractionRequest | null;
  readonly providerResult: ListingExtractionProviderResult | null;
}

export interface ListingExtractionMergeResult {
  readonly extraction: ListingExtraction;
  readonly extractionMethods: Readonly<Record<ListingExtractionFieldName, FieldExtractionMethod>>;
  readonly acceptedProviderFields: readonly ListingExtractionFieldName[];
  readonly rejectedProviderFields: readonly ListingExtractionFieldName[];
  readonly validationIssues: readonly ExtractionValidationIssue[];
}

export function mergeListingExtraction(
  input: ListingExtractionMergeInput
): ListingExtractionMergeResult {
  const providerResult =
    input.providerResult === null
      ? null
      : ListingExtractionProviderResultSchema.parse(input.providerResult);
  const requestedFields = new Set(
    input.request?.fieldRequests.map((fieldRequest) => fieldRequest.field) ?? []
  );
  const validationIssues =
    input.request === null || providerResult === null
      ? []
      : validateExtractionEvidence(input.request, providerResult.extraction);
  const fieldsWithIssues = new Set(validationIssues.map((issue) => issue.field));
  const acceptedProviderFields: ListingExtractionFieldName[] = [];
  const rejectedProviderFields: ListingExtractionFieldName[] = [];
  const extractionEntries: [ListingExtractionFieldName, unknown][] = [];
  const methodEntries: [ListingExtractionFieldName, FieldExtractionMethod][] = [];

  for (const field of ListingExtractionFieldNameSchema.options) {
    const deterministicField = input.deterministic.extraction[field];
    const providerField = providerResult?.extraction[field];
    const providerAccepted =
      deterministicField.status === "unknown" &&
      providerField?.status === "known" &&
      requestedFields.has(field) &&
      !fieldsWithIssues.has(field);
    if (providerAccepted) {
      extractionEntries.push([field, providerField]);
      methodEntries.push([field, "ai"]);
      acceptedProviderFields.push(field);
      continue;
    }

    extractionEntries.push([field, deterministicField]);
    methodEntries.push([field, input.deterministic.extractionMethods[field]]);
    if (providerField?.status === "known") rejectedProviderFields.push(field);
  }

  const extraction = ListingExtractionSchema.parse(Object.fromEntries(extractionEntries));
  const extractionMethods = Object.fromEntries(methodEntries) as Record<
    ListingExtractionFieldName,
    FieldExtractionMethod
  >;
  return {
    extraction,
    extractionMethods,
    acceptedProviderFields,
    rejectedProviderFields,
    validationIssues
  };
}
