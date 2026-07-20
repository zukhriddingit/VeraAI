import { createHash } from "node:crypto";

export class DeterministicSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeterministicSerializationError";
  }
}

function canonicalValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DeterministicSerializationError(`Non-finite number at ${path}.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalValue(entry, `${path}[${String(index)}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DeterministicSerializationError(`Non-plain object at ${path}.`);
    }
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) {
        throw new DeterministicSerializationError(`Undefined value at ${path}.${key}.`);
      }
      result[key] = canonicalValue(entry, `${path}.${key}`);
    }
    return result;
  }
  throw new DeterministicSerializationError(`Unsupported ${typeof value} value at ${path}.`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value, "$"));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function stableEntityId(prefix: string, value: unknown): string {
  if (!/^[a-z][a-z0-9-]{0,39}$/u.test(prefix)) {
    throw new DeterministicSerializationError("Stable entity ID prefixes must be safe kebab-case.");
  }
  return `${prefix}:${sha256Canonical(value).slice(0, 32)}`;
}
