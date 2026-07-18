import { LLMRateLimitError } from "@vera/ai";
import { describe, expect, it } from "vitest";

import { safeWorkerErrorFields } from "./logger.ts";

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
});
