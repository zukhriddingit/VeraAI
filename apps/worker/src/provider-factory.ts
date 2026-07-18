import {
  DEFAULT_LLM_TIMEOUT_MILLISECONDS,
  OpenAIResponsesProvider,
  resolveLLMConfiguration,
  type LLMProvider
} from "@vera/ai";

type Environment = Readonly<Record<string, string | undefined>>;

export interface WorkerProviderRuntime {
  readonly provider: LLMProvider | null;
  readonly timeoutMilliseconds: number;
}

export interface OpenAIProviderConfiguration {
  readonly apiKey: string;
  readonly model: string;
}

export interface WorkerProviderFactoryOptions {
  readonly environment?: Environment;
  readonly createOpenAIProvider?: (configuration: OpenAIProviderConfiguration) => LLMProvider;
}

function defaultOpenAIProvider(configuration: OpenAIProviderConfiguration): LLMProvider {
  return new OpenAIResponsesProvider(configuration);
}

/** Runtime selection is fail-closed and never substitutes the deterministic test mock. */
export function createWorkerProviderRuntime(
  options: WorkerProviderFactoryOptions = {}
): WorkerProviderRuntime {
  const configuration = resolveLLMConfiguration(options.environment ?? process.env);
  if (configuration.mode === "disabled") {
    return { provider: null, timeoutMilliseconds: DEFAULT_LLM_TIMEOUT_MILLISECONDS };
  }

  const createProvider = options.createOpenAIProvider ?? defaultOpenAIProvider;
  return {
    provider: createProvider({ apiKey: configuration.apiKey, model: configuration.model }),
    timeoutMilliseconds: configuration.timeoutMilliseconds
  };
}
