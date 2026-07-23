import { LLMRateLimitError } from "@vera/ai";
import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";

import { createWorkerLogger, safeWorkerErrorFields } from "./logger.ts";

describe("safe worker error logging", () => {
  it("keeps only typed provider metadata and never error messages or raw values", () => {
    const error = new LLMRateLimitError({ providerId: "openai", model: "configured-model" });
    const fields = safeWorkerErrorFields(error);

    expect(fields).toEqual({
      code: "llm_rate_limited",
      category: "rate_limit",
      retryable: true,
      providerId: "openai",
      model: "configured-model"
    });
    expect(JSON.stringify(fields)).not.toContain(error.message);
    expect(JSON.stringify(fields)).not.toContain("apiKey");
  });

  it("maps arbitrary errors to a fixed internal view", () => {
    expect(safeWorkerErrorFields(new Error("raw provider body and secret"))).toEqual({
      code: "worker_internal_error",
      category: "internal",
      retryable: true,
      providerId: null,
      model: null
    });
  });

  it("sanitizes every nested binding before structured serialization", () => {
    let output = "";
    const destination: DestinationStream = {
      write(chunk: string) {
        output += chunk;
      }
    };
    const logger = createWorkerLogger(destination);

    logger.warn(
      {
        correlationId: "correlation-1",
        safeCode: "gmail_timeout",
        retryable: true,
        provider: {
          authorization: "Bearer synthetic-secret",
          contact: { email: "person@example.test", phone: "+1 617 555 1212" }
        }
      },
      "Provider operation failed safely."
    );

    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record).toMatchObject({
      service: "vera-worker",
      correlationId: "correlation-1",
      safeCode: "gmail_timeout",
      retryable: true
    });
    expect(output).not.toContain("synthetic-secret");
    expect(output).not.toContain("person@example.test");
    expect(output).not.toContain("617 555 1212");
  });
});
