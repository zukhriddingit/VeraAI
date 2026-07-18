import {
  ListingExtractionProviderResultSchema,
  ListingExtractionRequestSchema,
  ListingExtractionSchema,
  type ListingExtraction,
  type ListingExtractionProviderResult,
  type ListingExtractionRequest
} from "@vera/domain";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError
} from "openai";
import { ContentFilterFinishReasonError, LengthFinishReasonError } from "openai/core/error";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { MAX_LLM_TIMEOUT_MILLISECONDS, MIN_LLM_TIMEOUT_MILLISECONDS } from "./config.ts";
import type { LLMProvider, LLMProviderOptions, MonotonicClock } from "./contracts.ts";
import { systemMonotonicClock } from "./contracts.ts";
import {
  LLMAuthenticationError,
  LLMCancelledError,
  LLMConfigurationError,
  LLMError,
  LLMInvalidOutputError,
  LLMPermanentProviderError,
  LLMRateLimitError,
  LLMRefusalError,
  LLMTimeoutError,
  LLMTransientProviderError
} from "./errors.ts";
import { validateExtractionEvidence } from "./evidence-validator.ts";
import {
  buildListingExtractionPrompt,
  buildListingExtractionRepairPrompt,
  type ExtractionRepairIssue,
  type ListingExtractionPrompt
} from "./prompt.ts";

export interface OpenAIExtractionAttemptRequest {
  readonly model: string;
  readonly prompt: ListingExtractionPrompt;
  readonly schemaName: "listing_extraction";
  readonly store: false;
  readonly tools: readonly [];
}

export interface OpenAIExtractionAttemptResponse {
  readonly responseId: string | null;
  readonly parsed: unknown;
  readonly refused: boolean;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

export interface OpenAIListingExtractionTransport {
  parse(
    request: OpenAIExtractionAttemptRequest,
    options: LLMProviderOptions
  ): Promise<OpenAIExtractionAttemptResponse>;
}

interface ResponseWithOutputContent {
  readonly output: readonly {
    readonly type: string;
    readonly content?: readonly { readonly type: string }[];
  }[];
}

function refusalPresent(response: ResponseWithOutputContent): boolean {
  return response.output.some(
    (item) =>
      item.type === "message" && (item.content ?? []).some((content) => content.type === "refusal")
  );
}

export class OfficialOpenAIResponsesTransport implements OpenAIListingExtractionTransport {
  readonly #client: OpenAI;

  constructor(client: OpenAI) {
    this.#client = client;
  }

  async parse(
    request: OpenAIExtractionAttemptRequest,
    options: LLMProviderOptions
  ): Promise<OpenAIExtractionAttemptResponse> {
    const response = await this.#client.responses.parse(
      {
        model: request.model,
        input: [
          { role: "developer", content: request.prompt.developer },
          { role: "user", content: request.prompt.user }
        ],
        text: {
          format: zodTextFormat(ListingExtractionSchema, request.schemaName)
        },
        store: request.store,
        tools: [...request.tools]
      },
      {
        signal: options.signal,
        timeout: options.timeoutMilliseconds
      }
    );

    return {
      responseId: response.id,
      parsed: response.output_parsed,
      refused: refusalPresent(response),
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        totalTokens:
          response.usage?.total_tokens ??
          (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
      }
    };
  }
}

export interface OpenAIResponsesProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly transport?: OpenAIListingExtractionTransport;
  readonly clock?: MonotonicClock;
}

type Usage = OpenAIExtractionAttemptResponse["usage"];

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens
  };
}

function providerStatusClass(status: number | undefined): "4xx" | "5xx" | null {
  if (status !== undefined && status >= 400 && status < 500) return "4xx";
  if (status !== undefined && status >= 500 && status < 600) return "5xx";
  return null;
}

function requestId(error: unknown): string | null {
  return error instanceof APIError ? (error.requestID ?? null) : null;
}

function mapProviderError(
  error: unknown,
  context: { readonly providerId: string; readonly model: string }
): LLMError {
  if (error instanceof LLMError) return error;

  const shared = {
    ...context,
    requestId: requestId(error),
    providerStatusClass: error instanceof APIError ? providerStatusClass(error.status) : null
  };
  if (error instanceof APIUserAbortError) return new LLMCancelledError(shared);
  if (error instanceof APIConnectionTimeoutError) return new LLMTimeoutError(shared);
  if (error instanceof AuthenticationError) return new LLMAuthenticationError(shared);
  if (error instanceof RateLimitError) return new LLMRateLimitError(shared);
  if (error instanceof PermissionDeniedError) return new LLMPermanentProviderError(shared);
  if (error instanceof APIConnectionError) return new LLMTransientProviderError(shared);
  if (error instanceof ContentFilterFinishReasonError) return new LLMRefusalError(shared);
  if (error instanceof LengthFinishReasonError) return new LLMPermanentProviderError(shared);
  if (error instanceof APIError && (error.status ?? 0) >= 500) {
    return new LLMTransientProviderError(shared);
  }
  return new LLMPermanentProviderError(shared);
}

function structuralIssue(): readonly ExtractionRepairIssue[] {
  return [{ code: "schema_invalid", field: "$" }];
}

function validTimeout(timeoutMilliseconds: number): boolean {
  return (
    Number.isSafeInteger(timeoutMilliseconds) &&
    timeoutMilliseconds >= MIN_LLM_TIMEOUT_MILLISECONDS &&
    timeoutMilliseconds <= MAX_LLM_TIMEOUT_MILLISECONDS
  );
}

export class OpenAIResponsesProvider implements LLMProvider {
  readonly providerId = "openai";
  readonly model: string;

  readonly #transport: OpenAIListingExtractionTransport;
  readonly #clock: MonotonicClock;

  constructor(options: OpenAIResponsesProviderOptions) {
    const apiKey = options.apiKey.trim();
    const model = options.model.trim();
    if (apiKey.length === 0 || model.length === 0) {
      throw new LLMConfigurationError({ providerId: this.providerId });
    }

    this.model = model;
    this.#clock = options.clock ?? systemMonotonicClock;
    this.#transport =
      options.transport ??
      new OfficialOpenAIResponsesTransport(
        new OpenAI({
          apiKey,
          maxRetries: 0
        })
      );
  }

  async extract(
    request: ListingExtractionRequest,
    options: LLMProviderOptions
  ): Promise<ListingExtractionProviderResult> {
    const context = { providerId: this.providerId, model: this.model };
    if (!validTimeout(options.timeoutMilliseconds)) {
      throw new LLMConfigurationError(context);
    }
    if (options.signal.aborted) {
      throw new LLMCancelledError(context);
    }

    let parsedRequest: ListingExtractionRequest;
    try {
      parsedRequest = ListingExtractionRequestSchema.parse(request);
    } catch {
      throw new LLMConfigurationError(context);
    }

    const startedAt = this.#clock.now();
    let usage = ZERO_USAGE;
    let responseId: string | null = null;
    let repairCount: 0 | 1 = 0;
    let prompt = buildListingExtractionPrompt(parsedRequest);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: OpenAIExtractionAttemptResponse;
      try {
        response = await this.#transport.parse(
          {
            model: this.model,
            prompt,
            schemaName: "listing_extraction",
            store: false,
            tools: []
          },
          options
        );
      } catch (error: unknown) {
        if (options.signal.aborted) throw new LLMCancelledError(context);
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          if (attempt === 1) throw new LLMInvalidOutputError(context);
          repairCount = 1;
          prompt = buildListingExtractionRepairPrompt(parsedRequest, structuralIssue());
          continue;
        }
        throw mapProviderError(error, context);
      }

      usage = addUsage(usage, response.usage);
      responseId = response.responseId;
      if (response.refused) throw new LLMRefusalError({ ...context, requestId: responseId });

      let extraction: ListingExtraction;
      try {
        extraction = ListingExtractionSchema.parse(response.parsed);
      } catch {
        if (attempt === 1) {
          throw new LLMInvalidOutputError({ ...context, requestId: responseId });
        }
        repairCount = 1;
        prompt = buildListingExtractionRepairPrompt(parsedRequest, structuralIssue());
        continue;
      }

      const issues = validateExtractionEvidence(parsedRequest, extraction);
      if (issues.length > 0) {
        if (attempt === 1) {
          throw new LLMInvalidOutputError({ ...context, requestId: responseId });
        }
        repairCount = 1;
        prompt = buildListingExtractionRepairPrompt(parsedRequest, issues);
        continue;
      }

      try {
        return ListingExtractionProviderResultSchema.parse({
          providerId: this.providerId,
          model: this.model,
          responseId,
          extraction,
          usage,
          latencyMilliseconds: Math.max(0, Math.round(this.#clock.now() - startedAt)),
          repairCount
        });
      } catch {
        throw new LLMPermanentProviderError({ ...context, requestId: responseId });
      }
    }

    throw new LLMInvalidOutputError({ ...context, requestId: responseId });
  }
}
