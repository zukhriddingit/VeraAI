import { createHash } from "node:crypto";

import {
  JsonValueSchema,
  RawListingCaptureSchema,
  type JsonValue,
  type RawListingCapture
} from "@vera/domain";

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => sortJson(item));
  }

  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, JsonValue> = {};

    for (const key of Object.keys(value).sort()) {
      const child = value[key];

      if (child !== undefined) {
        sorted[key] = sortJson(child);
      }
    }

    return sorted;
  }

  return value;
}

export function canonicalJson(value: JsonValue): string {
  const parsed = JsonValueSchema.parse(value);
  return JSON.stringify(sortJson(parsed));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function computeRawContentHash(captureInput: RawListingCapture): string {
  const capture = RawListingCaptureSchema.parse(captureInput);
  const evidence = {
    captureMetadata: capture.captureMetadata,
    rawJson: capture.rawJson,
    rawText: capture.rawText
  };

  return sha256Text(`raw-content:v1:${canonicalJson(evidence)}`);
}

export function computeRawImportIdempotencyKey(
  captureInput: RawListingCapture,
  contentHash: string
): string {
  const capture = RawListingCaptureSchema.parse(captureInput);
  const identity = capture.sourceListingId ?? capture.sourceUrl ?? "none";
  return sha256Text(`raw-import:v1:${capture.source}:${identity}:${contentHash}`);
}
