export type LLMErrorCategory =
  | "configuration"
  | "timeout"
  | "cancelled"
  | "authentication"
  | "rate_limit"
  | "transient_provider"
  | "permanent_provider"
  | "refusal"
  | "invalid_output";

export type LLMErrorCode =
  | "llm_configuration_invalid"
  | "llm_timeout"
  | "llm_cancelled"
  | "llm_authentication_failed"
  | "llm_rate_limited"
  | "llm_transient_provider_error"
  | "llm_permanent_provider_error"
  | "llm_refused"
  | "llm_invalid_output";

export interface SafeLLMErrorMetadata {
  readonly code: LLMErrorCode;
  readonly category: LLMErrorCategory;
  readonly retryable: boolean;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly requestId: string | null;
  readonly providerStatusClass: "4xx" | "5xx" | null;
}

interface LLMErrorOptions {
  readonly code: LLMErrorCode;
  readonly category: LLMErrorCategory;
  readonly retryable: boolean;
  readonly message: string;
  readonly providerId?: string | null;
  readonly model?: string | null;
  readonly requestId?: string | null;
  readonly providerStatusClass?: "4xx" | "5xx" | null;
}

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  readonly category: LLMErrorCategory;
  readonly retryable: boolean;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly requestId: string | null;
  readonly providerStatusClass: "4xx" | "5xx" | null;

  constructor(options: LLMErrorOptions) {
    super(options.message);
    this.name = new.target.name;
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable;
    this.providerId = options.providerId ?? null;
    this.model = options.model ?? null;
    this.requestId = options.requestId ?? null;
    this.providerStatusClass = options.providerStatusClass ?? null;
  }

  toSafeMetadata(): SafeLLMErrorMetadata {
    return {
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      providerId: this.providerId,
      model: this.model,
      requestId: this.requestId,
      providerStatusClass: this.providerStatusClass
    };
  }
}

type ProviderErrorContext = {
  readonly providerId?: string | null;
  readonly model?: string | null;
  readonly requestId?: string | null;
  readonly providerStatusClass?: "4xx" | "5xx" | null;
};

export class LLMConfigurationError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_configuration_invalid",
      category: "configuration",
      retryable: false,
      message: "Live LLM configuration is invalid.",
      ...context
    });
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_timeout",
      category: "timeout",
      retryable: true,
      message: "The LLM request timed out.",
      ...context
    });
  }
}

export class LLMCancelledError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_cancelled",
      category: "cancelled",
      retryable: true,
      message: "The LLM request was cancelled.",
      ...context
    });
  }
}

export class LLMAuthenticationError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_authentication_failed",
      category: "authentication",
      retryable: false,
      message: "The LLM provider rejected authentication.",
      ...context
    });
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_rate_limited",
      category: "rate_limit",
      retryable: true,
      message: "The LLM provider rate-limited the request.",
      ...context
    });
  }
}

export class LLMTransientProviderError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_transient_provider_error",
      category: "transient_provider",
      retryable: true,
      message: "The LLM provider encountered a transient failure.",
      ...context
    });
  }
}

export class LLMPermanentProviderError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_permanent_provider_error",
      category: "permanent_provider",
      retryable: false,
      message: "The LLM provider rejected the request.",
      ...context
    });
  }
}

export class LLMRefusalError extends LLMError {
  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_refused",
      category: "refusal",
      retryable: false,
      message: "The LLM provider refused to extract this listing.",
      ...context
    });
  }
}

export class LLMInvalidOutputError extends LLMError {
  readonly repairCount: 1;

  constructor(context: ProviderErrorContext = {}) {
    super({
      code: "llm_invalid_output",
      category: "invalid_output",
      retryable: false,
      message: "The LLM provider returned invalid structured output after repair.",
      ...context
    });
    this.repairCount = 1;
  }
}

export function isLLMError(value: unknown): value is LLMError {
  return value instanceof LLMError;
}
