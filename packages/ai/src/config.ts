import { LLMConfigurationError } from "./errors.ts";

export const DEFAULT_LLM_TIMEOUT_MILLISECONDS = 20_000;
export const MIN_LLM_TIMEOUT_MILLISECONDS = 1_000;
export const MAX_LLM_TIMEOUT_MILLISECONDS = 30_000;

export type LLMRuntimeConfiguration =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "openai";
      readonly apiKey: string;
      readonly model: string;
      readonly timeoutMilliseconds: number;
    };

type Environment = Readonly<Record<string, string | undefined>>;

function parseTimeout(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return DEFAULT_LLM_TIMEOUT_MILLISECONDS;
  }

  const trimmed = rawValue.trim();
  if (!/^\d+$/u.test(trimmed)) {
    throw new LLMConfigurationError();
  }

  const timeoutMilliseconds = Number(trimmed);
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < MIN_LLM_TIMEOUT_MILLISECONDS ||
    timeoutMilliseconds > MAX_LLM_TIMEOUT_MILLISECONDS
  ) {
    throw new LLMConfigurationError();
  }

  return timeoutMilliseconds;
}

export function resolveLLMConfiguration(environment: Environment): LLMRuntimeConfiguration {
  const rawApiKey = environment.OPENAI_API_KEY;
  const rawModel = environment.VERA_LLM_MODEL;

  if (rawApiKey === undefined && rawModel === undefined) {
    if (environment.VERA_LLM_TIMEOUT_MS !== undefined) {
      parseTimeout(environment.VERA_LLM_TIMEOUT_MS);
    }
    return { mode: "disabled" };
  }

  if (rawApiKey === undefined || rawModel === undefined) {
    throw new LLMConfigurationError({ providerId: "openai" });
  }

  const apiKey = rawApiKey.trim();
  const model = rawModel.trim();
  if (apiKey.length === 0 || model.length === 0) {
    throw new LLMConfigurationError({ providerId: "openai" });
  }

  return {
    mode: "openai",
    apiKey,
    model,
    timeoutMilliseconds: parseTimeout(environment.VERA_LLM_TIMEOUT_MS)
  };
}
