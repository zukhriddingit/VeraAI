import { describe, expect, it } from "vitest";

import type { RawListingCapture } from "@vera/domain";

import { canonicalJson, computeRawContentHash, computeRawImportIdempotencyKey } from "./hashing.ts";

const capture: RawListingCapture = {
  id: "raw-hash-test",
  source: "zillow",
  sourceListingId: "fixture-001",
  sourceUrl: "https://example.invalid/fixtures/hash-test",
  captureMethod: "fixture",
  observedAt: "2026-07-17T12:00:00.000Z",
  sourcePostedAt: null,
  rawText: "Sanitized synthetic fixture.",
  rawJson: { price: 2400, details: { beds: 1, baths: 1 } },
  captureMetadata: { fixture: true, revision: 1 }
};

describe("deterministic raw evidence hashing", () => {
  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 })
    );
    expect(canonicalJson({ values: [1, 2] })).not.toBe(canonicalJson({ values: [2, 1] }));
  });

  it("produces the same content hash for reordered evidence keys", () => {
    const reordered: RawListingCapture = {
      ...capture,
      rawJson: { details: { baths: 1, beds: 1 }, price: 2400 },
      captureMetadata: { revision: 1, fixture: true }
    };

    expect(computeRawContentHash(reordered)).toBe(computeRawContentHash(capture));
  });

  it("changes the content hash when captured evidence changes", () => {
    expect(computeRawContentHash({ ...capture, rawText: "Changed fixture evidence." })).not.toBe(
      computeRawContentHash(capture)
    );
  });

  it("binds the idempotency key to source identity and content", () => {
    const contentHash = computeRawContentHash(capture);
    const first = computeRawImportIdempotencyKey(capture, contentHash);
    const changedIdentity = computeRawImportIdempotencyKey(
      { ...capture, sourceListingId: "fixture-002" },
      contentHash
    );

    expect(first).toHaveLength(64);
    expect(changedIdentity).not.toBe(first);
  });
});
