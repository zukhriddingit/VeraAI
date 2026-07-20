import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHOTO_DECODE_LIMITS,
  PhotoProcessingError,
  SharpPhotoDecoder,
  computeDHash64,
  hashPhotoBytes,
  photoHashHammingDistance,
  type PhotoDecoder
} from "./photos.ts";

const fixtureDirectory = fileURLToPath(new URL("../../testing/fixtures/photos/", import.meta.url));

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(`${fixtureDirectory}${name}`));
}

describe("production photo hashing", () => {
  const decoder = new SharpPhotoDecoder();

  it("records bounded metadata and a versioned deterministic dHash", async () => {
    const bytes = await fixture("synthetic-building-base.png");
    const first = await hashPhotoBytes(bytes, decoder);
    const second = await hashPhotoBytes(bytes, decoder);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      width: 640,
      height: 480,
      mimeType: "image/png",
      perceptualHashVersion: "listing-photo.dhash64.v1"
    });
    expect(first.byteHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.perceptualHash).toMatch(/^[a-f0-9]{16}$/u);
  });

  it("keeps transformed fixture photos near and distinct fixtures far", async () => {
    const [base, transformed, different] = await Promise.all([
      hashPhotoBytes(await fixture("synthetic-building-base.png"), decoder),
      hashPhotoBytes(await fixture("synthetic-building-transformed.png"), decoder),
      hashPhotoBytes(await fixture("synthetic-building-different.png"), decoder)
    ]);

    expect(
      photoHashHammingDistance(base.perceptualHash, transformed.perceptualHash)
    ).toBeLessThanOrEqual(4);
    expect(photoHashHammingDistance(base.perceptualHash, different.perceptualHash)).toBeGreaterThan(
      4
    );
    expect(photoHashHammingDistance(base.perceptualHash, base.perceptualHash)).toBe(0);
  });

  it("computes bits from exact horizontal grayscale comparisons", () => {
    const ascending = Uint8Array.from({ length: 72 }, (_, index) => index % 9);
    const descending = Uint8Array.from({ length: 72 }, (_, index) => 8 - (index % 9));
    expect(computeDHash64(ascending)).toBe("0000000000000000");
    expect(computeDHash64(descending)).toBe("ffffffffffffffff");
    expect(photoHashHammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("rejects oversized input before invoking a decoder", async () => {
    let called = false;
    const mock: PhotoDecoder = {
      async decodeForHash() {
        called = true;
        throw new Error("must not run");
      }
    };

    await expect(
      hashPhotoBytes(new Uint8Array(11), mock, {
        ...DEFAULT_PHOTO_DECODE_LIMITS,
        maxBytes: 10
      })
    ).rejects.toMatchObject({ code: "input_too_large" });
    expect(called).toBe(false);
  });

  it("fails closed for corrupt bytes and unsafe dimensions", async () => {
    await expect(hashPhotoBytes(new Uint8Array([1, 2, 3]), decoder)).rejects.toMatchObject({
      code: "decode_failed"
    });
    await expect(
      hashPhotoBytes(await fixture("synthetic-building-base.png"), decoder, {
        ...DEFAULT_PHOTO_DECODE_LIMITS,
        maxWidth: 100
      })
    ).rejects.toMatchObject({ code: "unsafe_dimensions" });

    const unsafeDecoder: PhotoDecoder = {
      async decodeForHash(input) {
        return {
          byteSize: input.byteLength,
          width: 101,
          height: 10,
          mimeType: "image/png",
          grayscalePixels9x8: new Uint8Array(72)
        };
      }
    };
    await expect(
      hashPhotoBytes(new Uint8Array([1]), unsafeDecoder, {
        ...DEFAULT_PHOTO_DECODE_LIMITS,
        maxWidth: 100
      })
    ).rejects.toMatchObject({ code: "unsafe_dimensions" });
  });

  it("validates hash and pixel boundaries", () => {
    expect(() => computeDHash64(new Uint8Array(71))).toThrow(PhotoProcessingError);
    expect(() => photoHashHammingDistance("not-a-hash", "0".repeat(16))).toThrow(
      PhotoProcessingError
    );
  });
});
