import { createHash } from "node:crypto";

import {
  LISTING_EXTRACTION_PROMPT_VERSION,
  LISTING_EXTRACTION_VERSION,
  ListingExtractionProviderResultSchema,
  ListingExtractionRequestSchema
} from "@vera/domain";
import { describe, expect, it } from "vitest";

import { resolveLLMConfiguration } from "./config.ts";
import { OpenAIResponsesProvider } from "./openai-provider.ts";

const liveEnabled =
  process.env.VERA_RUN_LIVE_LLM_TESTS === "1" &&
  (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0 &&
  (process.env.VERA_LLM_MODEL?.trim().length ?? 0) > 0;

const liveDescribe = liveEnabled ? describe : describe.skip;

liveDescribe("OpenAI Responses live structured extraction", () => {
  it("parses one small sanitized listing through the configured model", async () => {
    const configuration = resolveLLMConfiguration(process.env);
    if (configuration.mode !== "openai") {
      throw new Error("The explicit live-test configuration was not enabled.");
    }

    const evidenceText = `Title: Synthetic garden studio
Base rent: USD 2200 per month
Cats allowed.`;
    const request = ListingExtractionRequestSchema.parse({
      evidenceText,
      inputHash: createHash("sha256").update(evidenceText, "utf8").digest("hex"),
      fieldRequests: [
        { field: "title", reason: "not_present" },
        { field: "baseRent", reason: "not_present" },
        { field: "catsAllowed", reason: "not_present" }
      ],
      promptVersion: LISTING_EXTRACTION_PROMPT_VERSION,
      extractionVersion: LISTING_EXTRACTION_VERSION
    });
    const provider = new OpenAIResponsesProvider(configuration);
    const result = await provider.extract(request, {
      signal: new AbortController().signal,
      timeoutMilliseconds: configuration.timeoutMilliseconds
    });

    expect(ListingExtractionProviderResultSchema.parse(result)).toEqual(result);
    expect(result.providerId).toBe("openai");
    expect(result.model).toBe(configuration.model);
    expect(result.usage.totalTokens).toBe(result.usage.inputTokens + result.usage.outputTokens);
    expect(result.latencyMilliseconds).toBeGreaterThanOrEqual(0);
  });
});
