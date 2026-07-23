const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|api.?key|token|code.?verifier|email|phone|contact|evidence|prompt|raw|snapshot|request.?body|response.?body)/iu;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE_VALUE = /(?:^|[^\d])(\+?\d[\d .()-]{7,}\d)(?:$|[^\d])/u;
const BEARER_VALUE = /\bBearer\s+\S+/iu;

export interface LogSanitizerOptions {
  readonly maxDepth?: number;
  readonly maxStringLength?: number;
  readonly maxArrayEntries?: number;
  readonly maxObjectEntries?: number;
}

interface ResolvedOptions {
  readonly maxDepth: number;
  readonly maxStringLength: number;
  readonly maxArrayEntries: number;
  readonly maxObjectEntries: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  maxDepth: 8,
  maxStringLength: 2_048,
  maxArrayEntries: 50,
  maxObjectEntries: 100
};

function resolveOptions(options: LogSanitizerOptions): ResolvedOptions {
  return {
    maxDepth: options.maxDepth ?? DEFAULT_OPTIONS.maxDepth,
    maxStringLength: options.maxStringLength ?? DEFAULT_OPTIONS.maxStringLength,
    maxArrayEntries: options.maxArrayEntries ?? DEFAULT_OPTIONS.maxArrayEntries,
    maxObjectEntries: options.maxObjectEntries ?? DEFAULT_OPTIONS.maxObjectEntries
  };
}

function sanitizedString(value: string, options: ResolvedOptions): string {
  const phoneCandidate = PHONE_VALUE.exec(value)?.[1];
  const phoneDigits = phoneCandidate?.replaceAll(/\D/gu, "").length ?? 0;
  if (
    EMAIL_VALUE.test(value) ||
    (phoneDigits >= 10 && phoneDigits <= 15) ||
    BEARER_VALUE.test(value)
  ) {
    return "[REDACTED]";
  }
  let sanitized = value;
  try {
    const url = new URL(value);
    if (url.search || url.hash || url.username || url.password) {
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      sanitized = url.href;
    }
  } catch {
    // Most log strings are not URLs and need no URL-specific handling.
  }
  return sanitized.length > options.maxStringLength
    ? `${sanitized.slice(0, options.maxStringLength)}[TRUNCATED]`
    : sanitized;
}

function sanitize(
  value: unknown,
  options: ResolvedOptions,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (depth > options.maxDepth) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizedString(value, options);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[UNSERIALIZABLE]";
  if (typeof value !== "object") return "[UNSERIALIZABLE]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[UNSERIALIZABLE]" : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, options.maxArrayEntries)
      .map((entry) => sanitize(entry, options, depth + 1, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, options.maxObjectEntries)
      .map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(entry, options, depth + 1, seen)
      ])
  );
}

export function sanitizeLogValue(value: unknown, options: LogSanitizerOptions = {}): unknown {
  return sanitize(value, resolveOptions(options), 0, new WeakSet<object>());
}
