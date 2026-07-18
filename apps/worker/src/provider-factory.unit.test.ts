import { LLMConfigurationError, type LLMProvider } from "@vera/ai";
import { describe, expect, it, vi } from "vitest";

import { createWorkerProviderRuntime } from "./provider-factory.ts";

const provider: LLMProvider = {
  providerId: "openai",
  model: "configured-model",
  extract: vi.fn()
};

describe("worker provider factory", () => {
  it("returns deterministic-only runtime without constructing an OpenAI provider", () => {
    const createOpenAIProvider = vi.fn(() => provider);
    const runtime = createWorkerProviderRuntime({
      environment: {},
      createOpenAIProvider
    });

    expect(runtime).toEqual({ provider: null, timeoutMilliseconds: 20_000 });
    expect(createOpenAIProvider).not.toHaveBeenCalled();
  });

  it("constructs only the configured live provider with the validated timeout", () => {
    const createOpenAIProvider = vi.fn(() => provider);
    const runtime = createWorkerProviderRuntime({
      environment: {
        OPENAI_API_KEY: "local-test-key",
        VERA_LLM_MODEL: "configured-model",
        VERA_LLM_TIMEOUT_MS: "1000"
      },
      createOpenAIProvider
    });

    expect(runtime).toEqual({ provider, timeoutMilliseconds: 1_000 });
    expect(createOpenAIProvider).toHaveBeenCalledWith({
      apiKey: "local-test-key",
      model: "configured-model"
    });
  });

  it.each([
    { OPENAI_API_KEY: "key-only" },
    { VERA_LLM_MODEL: "model-only" },
    { OPENAI_API_KEY: "key", VERA_LLM_MODEL: "model", VERA_LLM_TIMEOUT_MS: "999" },
    { OPENAI_API_KEY: "key", VERA_LLM_MODEL: "model", VERA_LLM_TIMEOUT_MS: "30001" }
  ])("fails closed for partial or invalid configuration %#", (environment) => {
    const createOpenAIProvider = vi.fn(() => provider);
    expect(() => createWorkerProviderRuntime({ environment, createOpenAIProvider })).toThrow(
      LLMConfigurationError
    );
    expect(createOpenAIProvider).not.toHaveBeenCalled();
  });
});
