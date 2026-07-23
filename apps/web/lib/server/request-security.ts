export class CrossOriginMutationError extends Error {
  constructor() {
    super("The mutation origin is not trusted.");
    this.name = "CrossOriginMutationError";
  }
}

export type MutationRequestErrorCode =
  "unsupported_media_type" | "payload_too_large" | "malformed_json";

export class MutationRequestError extends Error {
  constructor(
    readonly code: MutationRequestErrorCode,
    readonly status: 400 | 413 | 415
  ) {
    super(code);
    this.name = "MutationRequestError";
  }
}

export async function readBoundedJson(
  request: Request,
  options: { readonly maxBytes: number }
): Promise<unknown> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new RangeError("Mutation JSON byte limit must be a positive safe integer.");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new MutationRequestError("unsupported_media_type", 415);
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > options.maxBytes)
  ) {
    throw new MutationRequestError("payload_too_large", 413);
  }
  if (request.body === null) {
    throw new MutationRequestError("malformed_json", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > options.maxBytes) {
      try {
        await reader.cancel("payload_too_large");
      } catch {
        // Preserve the deterministic request error if stream cleanup itself fails.
      }
      throw new MutationRequestError("payload_too_large", 413);
    }
    chunks.push(item.value);
  }

  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } catch {
    throw new MutationRequestError("malformed_json", 400);
  }
}

export function trustedPublicOrigin(request: Request): string {
  const configured = process.env.VERA_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.origin !== configured ||
        (process.env.NODE_ENV === "production" && url.protocol !== "https:") ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new CrossOriginMutationError();
      }
      return url.origin;
    } catch {
      throw new CrossOriginMutationError();
    }
  }
  if (process.env.NODE_ENV === "production") throw new CrossOriginMutationError();
  return new URL(request.url).origin;
}

export function assertTrustedCallbackOrigin(request: Request): void {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    throw new CrossOriginMutationError();
  }
  if (requestOrigin !== trustedPublicOrigin(request)) throw new CrossOriginMutationError();
}

export function assertSameOriginMutation(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null) throw new CrossOriginMutationError();

  let parsedOrigin: string;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new CrossOriginMutationError();
    }
    parsedOrigin = parsed.origin;
  } catch {
    throw new CrossOriginMutationError();
  }

  if (parsedOrigin !== trustedPublicOrigin(request)) throw new CrossOriginMutationError();
}
