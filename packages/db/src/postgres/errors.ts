export type PostgresErrorCategory =
  | "configuration"
  | "unavailable"
  | "timeout"
  | "validation"
  | "not_found"
  | "conflict"
  | "ownership_violation"
  | "serialization"
  | "internal";

export class PostgresRepositoryError extends Error {
  readonly category: PostgresErrorCategory;
  readonly retryable: boolean;

  constructor(category: PostgresErrorCategory, retryable: boolean, message: string) {
    super(message);
    this.name = "PostgresRepositoryError";
    this.category = category;
    this.retryable = retryable;
  }
}

interface DriverErrorShape {
  readonly code?: unknown;
  readonly cause?: unknown;
}

function errorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null) return null;
  const shaped = error as DriverErrorShape;
  if (typeof shaped.code === "string") return shaped.code;
  return depth < 4 ? errorCode(shaped.cause, depth + 1) : null;
}

export function mapPostgresError(error: unknown): PostgresRepositoryError {
  if (error instanceof PostgresRepositoryError) return error;

  switch (errorCode(error)) {
    case "23505":
      return new PostgresRepositoryError("conflict", false, "The requested record conflicts.");
    case "23503":
      return new PostgresRepositoryError(
        "ownership_violation",
        false,
        "The requested relationship is invalid."
      );
    case "23502":
    case "23514":
    case "22P02":
      return new PostgresRepositoryError("validation", false, "The persisted value is invalid.");
    case "40001":
    case "40P01":
      return new PostgresRepositoryError("serialization", true, "The transaction must be retried.");
    case "57014":
      return new PostgresRepositoryError("timeout", true, "The database operation timed out.");
    case "ECONNREFUSED":
    case "ECONNRESET":
    case "ENOTFOUND":
    case "57P01":
    case "57P02":
    case "57P03":
      return new PostgresRepositoryError("unavailable", true, "The database is unavailable.");
    default:
      return new PostgresRepositoryError("internal", false, "The database operation failed.");
  }
}

export function safePostgresErrorFields(error: unknown): {
  readonly category: PostgresErrorCategory;
  readonly retryable: boolean;
} {
  const mapped = mapPostgresError(error);
  return { category: mapped.category, retryable: mapped.retryable };
}
