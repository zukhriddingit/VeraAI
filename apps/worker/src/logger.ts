import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { isLLMError } from "@vera/ai";

import { sanitizeLogValue } from "./log-sanitizer.js";

const allowedLogLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

type LogLevel = (typeof allowedLogLevels)[number];

function isLogLevel(value: string): value is LogLevel {
  return allowedLogLevels.some((level) => level === value);
}

function resolveLogLevel(value: string | undefined): LogLevel {
  if (value === undefined || value === "") {
    return "info";
  }

  if (!isLogLevel(value)) {
    throw new Error("VERA_LOG_LEVEL must be a supported Pino log level.");
  }

  return value;
}

export function createWorkerLogger(destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    base: {
      service: "vera-worker"
    },
    level: resolveLogLevel(process.env.VERA_LOG_LEVEL),
    redact: {
      paths: [
        "authorization",
        "*.authorization",
        "apiKey",
        "*.apiKey",
        "cookie",
        "*.cookie",
        "token",
        "*.token",
        "accessToken",
        "refreshToken",
        "email",
        "phone",
        "contactName",
        "contactEmail",
        "contactPhone",
        "contactUrl",
        "evidence",
        "evidenceSnippet",
        "prompt",
        "rawText",
        "rawJson",
        "requestBody",
        "responseBody"
      ],
      censor: "[REDACTED]"
    },
    formatters: {
      log(bindings) {
        return sanitizeLogValue(bindings) as Record<string, unknown>;
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime
  };
  return destination ? pino(options, destination) : pino(options);
}

export interface SafeWorkerErrorFields {
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly providerId: string | null;
  readonly model: string | null;
}

export function safeWorkerErrorFields(error: unknown): SafeWorkerErrorFields {
  if (isLLMError(error)) {
    const metadata = error.toSafeMetadata();
    return {
      code: metadata.code,
      category: metadata.category,
      retryable: metadata.retryable,
      providerId: metadata.providerId,
      model: metadata.model
    };
  }

  return {
    code: "worker_internal_error",
    category: "internal",
    retryable: true,
    providerId: null,
    model: null
  };
}
