import {
  ListingExtractionProviderResultSchema,
  ListingExtractionRequestSchema,
  type ListingExtractionProviderResult,
  type ListingExtractionRequest
} from "@vera/domain";

import type { LLMProvider, LLMProviderOptions } from "./contracts.ts";
import {
  LLMCancelledError,
  LLMConfigurationError,
  LLMError,
  LLMInvalidOutputError,
  LLMPermanentProviderError,
  LLMTimeoutError
} from "./errors.ts";

export type MockLLMResolver = (
  request: ListingExtractionRequest,
  options: LLMProviderOptions
) => unknown | Promise<unknown>;

export interface MockLLMProviderOptions {
  readonly model?: string;
  readonly responses?: ReadonlyMap<string, unknown>;
  readonly resolver?: MockLLMResolver;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function awaitWithControls(
  operation: Promise<unknown>,
  options: LLMProviderOptions,
  context: { readonly providerId: string; readonly model: string }
): Promise<unknown> {
  if (options.signal.aborted) {
    return Promise.reject(new LLMCancelledError(context));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      action();
    };
    const abort = (): void => finish(() => reject(new LLMCancelledError(context)));
    const timeout = setTimeout(
      () => finish(() => reject(new LLMTimeoutError(context))),
      options.timeoutMilliseconds
    );

    options.signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

export class MockLLMProvider implements LLMProvider {
  readonly providerId = "mock";
  readonly model: string;
  readonly requests: ListingExtractionRequest[] = [];

  readonly #responses: ReadonlyMap<string, unknown> | null;
  readonly #resolver: MockLLMResolver | null;

  constructor(options: MockLLMProviderOptions) {
    if ((options.responses === undefined) === (options.resolver === undefined)) {
      throw new LLMConfigurationError({
        providerId: "mock",
        model: options.model ?? "mock-v1"
      });
    }
    this.model = options.model ?? "mock-v1";
    this.#responses = options.responses ?? null;
    this.#resolver = options.resolver ?? null;
  }

  async extract(
    request: ListingExtractionRequest,
    options: LLMProviderOptions
  ): Promise<ListingExtractionProviderResult> {
    const parsedRequest = ListingExtractionRequestSchema.parse(clone(request));
    this.requests.push(clone(parsedRequest));
    const context = { providerId: this.providerId, model: this.model };

    try {
      const operation = Promise.resolve(
        this.#resolver === null
          ? this.#responses?.get(parsedRequest.inputHash)
          : this.#resolver(clone(parsedRequest), options)
      );
      const rawResult = await awaitWithControls(operation, options, context);
      if (rawResult === undefined) {
        throw new LLMPermanentProviderError(context);
      }
      const result = ListingExtractionProviderResultSchema.parse(rawResult);
      if (result.providerId !== this.providerId || result.model !== this.model) {
        throw new LLMInvalidOutputError(context);
      }
      return clone(result);
    } catch (error: unknown) {
      if (error instanceof LLMError) throw error;
      throw new LLMInvalidOutputError(context);
    }
  }
}
