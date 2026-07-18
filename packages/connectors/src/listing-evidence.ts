import { createHash } from "node:crypto";

import { Sha256Schema } from "@vera/domain";
import { z } from "zod";

import { RawListingEnvelopeSchema, type RawListingEnvelope } from "./contracts.ts";

const TEXT_BEGIN = "----- BEGIN USER-SUPPLIED LISTING TEXT -----";
const TEXT_END = "----- END USER-SUPPLIED LISTING TEXT -----";
const JSON_BEGIN = "----- BEGIN USER-SUPPLIED STRUCTURED JSON -----";
const JSON_END = "----- END USER-SUPPLIED STRUCTURED JSON -----";

export const ListingEvidenceSchema = z
  .object({
    evidenceText: z.string().min(1).max(300_000),
    inputHash: Sha256Schema
  })
  .strict();

export type ListingEvidence = z.infer<typeof ListingEvidenceSchema>;

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Structured listing numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  throw new TypeError("Structured listing evidence must be JSON-serializable.");
}

export function buildListingEvidence(inputEnvelope: RawListingEnvelope): ListingEvidence {
  const envelope = RawListingEnvelopeSchema.parse(inputEnvelope);
  const segments: string[] = [];
  if (envelope.rawText !== null) {
    segments.push(`${TEXT_BEGIN}\n${envelope.rawText}\n${TEXT_END}`);
  }
  if (envelope.rawJson !== null) {
    segments.push(`${JSON_BEGIN}\n${stableJson(envelope.rawJson)}\n${JSON_END}`);
  }

  const evidenceText = segments.join("\n");
  return ListingEvidenceSchema.parse({
    evidenceText,
    inputHash: createHash("sha256").update(evidenceText, "utf8").digest("hex")
  });
}
