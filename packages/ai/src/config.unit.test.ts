import { describe, expect, it } from "vitest";

import {
  DEFAULT_LLM_TIMEOUT_MILLISECONDS,
  MAX_LLM_TIMEOUT_MILLISECONDS,
  MIN_LLM_TIMEOUT_MILLISECONDS,
  resolveLLMConfiguration
} from "./config.ts";
import { LLMConfigurationError } from "./errors.ts";

describe("resolveLLMConfiguration", () => {
  it("disables live extraction when both key and model are absent", () => {
    expect(resolveLLMConfiguration({})).toEqual({ mode: "disabled" });
  });

  it("returns the enabled configuration only when key and model are both present", () => {
    expect(
      resolveLLMConfiguration({
        OPENAI_API_KEY: "  synthetic-test-key  ",
        VERA_LLM_MODEL: "  configured-model  "
      })
    ).toEqual({
      mode: "openai",
      apiKey: "synthetic-test-key",
      model: "configured-model",
      timeoutMilliseconds: DEFAULT_LLM_TIMEOUT_MILLISECONDS
    });
  });

  it.each([
    { OPENAI_API_KEY: "synthetic-test-key" },
    { VERA_LLM_MODEL: "configured-model" },
    { OPENAI_API_KEY: "", VERA_LLM_MODEL: "configured-model" },
    { OPENAI_API_KEY: "synthetic-test-key", VERA_LLM_MODEL: "   " }
  ])("rejects partial or blank configuration", (environment) => {
    expect(() => resolveLLMConfiguration(environment)).toThrow(LLMConfigurationError);
  });

  it.each([MIN_LLM_TIMEOUT_MILLISECONDS, MAX_LLM_TIMEOUT_MILLISECONDS])(
    "accepts inclusive timeout boundary %i",
    (timeoutMilliseconds) => {
      expect(
        resolveLLMConfiguration({
          OPENAI_API_KEY: "synthetic-test-key",
          VERA_LLM_MODEL: "configured-model",
          VERA_LLM_TIMEOUT_MS: String(timeoutMilliseconds)
        })
      ).toMatchObject({ timeoutMilliseconds });
    }
  );

  it.each(["", "999", "30001", "1.5", "not-a-number", "Infinity"])(
    "rejects invalid timeout %j without disclosing configuration",
    (timeout) => {
      let caught: unknown;
      try {
        resolveLLMConfiguration({
          OPENAI_API_KEY: "synthetic-secret-value",
          VERA_LLM_MODEL: "configured-model",
          VERA_LLM_TIMEOUT_MS: timeout
        });
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(LLMConfigurationError);
      expect(JSON.stringify(caught)).not.toContain("synthetic-secret-value");
      expect(String(caught)).not.toContain("synthetic-secret-value");
    }
  );
});
