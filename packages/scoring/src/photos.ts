import { createHash } from "node:crypto";

import sharp from "sharp";

import { PHOTO_HASH_VERSION, type PhotoHash } from "@vera/domain";

export const DEFAULT_PHOTO_DECODE_LIMITS = {
  maxBytes: 10_000_000,
  maxPixels: 40_000_000,
  maxWidth: 10_000,
  maxHeight: 10_000
} as const satisfies PhotoDecodeLimits;

export interface PhotoDecodeLimits {
  readonly maxBytes: number;
  readonly maxPixels: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export type SupportedPhotoMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

export interface DecodedPhoto {
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly mimeType: SupportedPhotoMimeType;
  readonly grayscalePixels9x8: Uint8Array;
}

export interface HashedPhotoMetadata {
  readonly byteHash: string;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly mimeType: SupportedPhotoMimeType;
  readonly perceptualHash: string;
  readonly perceptualHashVersion: typeof PHOTO_HASH_VERSION;
}

export interface PhotoDecoder {
  decodeForHash(input: Uint8Array, limits: PhotoDecodeLimits): Promise<DecodedPhoto>;
}

export type PhotoProcessingErrorCode =
  | "input_too_large"
  | "decode_failed"
  | "unsupported_media"
  | "unsafe_dimensions"
  | "animated_not_supported"
  | "invalid_pixels"
  | "invalid_hash";

export class PhotoProcessingError extends Error {
  readonly code: PhotoProcessingErrorCode;

  constructor(code: PhotoProcessingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PhotoProcessingError";
    this.code = code;
  }
}

const mimeTypes: Readonly<Record<string, SupportedPhotoMimeType | undefined>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif"
};

function validateLimits(limits: PhotoDecodeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new PhotoProcessingError("unsafe_dimensions", `${name} must be a positive integer.`);
    }
  }
}

export class SharpPhotoDecoder implements PhotoDecoder {
  async decodeForHash(input: Uint8Array, limits: PhotoDecodeLimits): Promise<DecodedPhoto> {
    validateLimits(limits);
    if (input.byteLength > limits.maxBytes) {
      throw new PhotoProcessingError(
        "input_too_large",
        `Photo bytes exceed the ${String(limits.maxBytes)} byte limit.`
      );
    }
    if (input.byteLength === 0) {
      throw new PhotoProcessingError("decode_failed", "Photo bytes are empty.");
    }

    const image = sharp(input, {
      animated: false,
      failOn: "error",
      limitInputPixels: limits.maxPixels,
      sequentialRead: true
    });
    let metadata: Awaited<ReturnType<typeof image.metadata>>;
    try {
      metadata = await image.metadata();
    } catch (cause) {
      throw new PhotoProcessingError("decode_failed", "Photo metadata could not be decoded.", {
        cause
      });
    }

    const mimeType = metadata.format === undefined ? undefined : mimeTypes[metadata.format];
    if (mimeType === undefined) {
      throw new PhotoProcessingError("unsupported_media", "Photo media type is not supported.");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new PhotoProcessingError(
        "animated_not_supported",
        "Animated or multi-page photos are not supported."
      );
    }
    const width = metadata.width;
    const height = metadata.height;
    if (
      width === undefined ||
      height === undefined ||
      width <= 0 ||
      height <= 0 ||
      width > limits.maxWidth ||
      height > limits.maxHeight ||
      width * height > limits.maxPixels
    ) {
      throw new PhotoProcessingError(
        "unsafe_dimensions",
        "Photo dimensions exceed the configured safety limits."
      );
    }

    try {
      const result = await image
        .clone()
        .rotate()
        .resize(9, 8, {
          fit: "fill",
          kernel: sharp.kernel.nearest
        })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (
        result.info.width !== 9 ||
        result.info.height !== 8 ||
        result.info.channels !== 1 ||
        result.data.byteLength !== 72
      ) {
        throw new PhotoProcessingError(
          "invalid_pixels",
          "Photo decoder did not return the required 9 by 8 grayscale pixels."
        );
      }
      return {
        byteSize: input.byteLength,
        width,
        height,
        mimeType,
        grayscalePixels9x8: new Uint8Array(result.data)
      };
    } catch (cause) {
      if (cause instanceof PhotoProcessingError) throw cause;
      throw new PhotoProcessingError("decode_failed", "Photo pixels could not be decoded.", {
        cause
      });
    }
  }
}

export function computeDHash64(grayscalePixels9x8: Uint8Array): string {
  if (grayscalePixels9x8.byteLength !== 72) {
    throw new PhotoProcessingError(
      "invalid_pixels",
      "dHash requires exactly 72 grayscale pixels in 9 by 8 row-major order."
    );
  }
  let value = 0n;
  let bit = 63n;
  for (let row = 0; row < 8; row += 1) {
    const rowOffset = row * 9;
    for (let column = 0; column < 8; column += 1) {
      const left = grayscalePixels9x8[rowOffset + column]!;
      const right = grayscalePixels9x8[rowOffset + column + 1]!;
      if (left > right) value |= 1n << bit;
      bit -= 1n;
    }
  }
  return value.toString(16).padStart(16, "0");
}

export function photoHashHammingDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/u.test(left) || !/^[a-f0-9]{16}$/u.test(right)) {
    throw new PhotoProcessingError(
      "invalid_hash",
      "Perceptual hashes must be 16 lowercase hexadecimal characters."
    );
  }
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (difference !== 0n) {
    difference &= difference - 1n;
    distance += 1;
  }
  return distance;
}

export async function hashPhotoBytes(
  input: Uint8Array,
  decoder: PhotoDecoder,
  limits: PhotoDecodeLimits = DEFAULT_PHOTO_DECODE_LIMITS
): Promise<HashedPhotoMetadata> {
  if (input.byteLength > limits.maxBytes) {
    throw new PhotoProcessingError(
      "input_too_large",
      `Photo bytes exceed the ${String(limits.maxBytes)} byte limit.`
    );
  }
  const decoded = await decoder.decodeForHash(input, limits);
  if (
    decoded.byteSize !== input.byteLength ||
    !Number.isSafeInteger(decoded.width) ||
    !Number.isSafeInteger(decoded.height) ||
    decoded.width <= 0 ||
    decoded.height <= 0 ||
    decoded.width > limits.maxWidth ||
    decoded.height > limits.maxHeight ||
    decoded.width * decoded.height > limits.maxPixels
  ) {
    throw new PhotoProcessingError(
      "unsafe_dimensions",
      "Photo decoder returned metadata outside the configured limits."
    );
  }
  if (!Object.values(mimeTypes).includes(decoded.mimeType)) {
    throw new PhotoProcessingError(
      "unsupported_media",
      "Photo decoder returned an unsupported media type."
    );
  }
  return {
    byteHash: createHash("sha256").update(input).digest("hex"),
    byteSize: decoded.byteSize,
    width: decoded.width,
    height: decoded.height,
    mimeType: decoded.mimeType,
    perceptualHash: computeDHash64(decoded.grayscalePixels9x8),
    perceptualHashVersion: PHOTO_HASH_VERSION
  };
}

export function toPhotoHash(listingPhotoId: string, metadata: HashedPhotoMetadata): PhotoHash {
  return {
    listingPhotoId,
    hash: metadata.perceptualHash,
    version: metadata.perceptualHashVersion
  };
}
