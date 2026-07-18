import type { ListingExtractionProviderResult, ListingExtractionRequest } from "@vera/domain";

export interface LLMProviderOptions {
  readonly signal: AbortSignal;
  readonly timeoutMilliseconds: number;
}

export interface LLMProvider {
  readonly providerId: string;
  readonly model: string;
  extract(
    request: ListingExtractionRequest,
    options: LLMProviderOptions
  ): Promise<ListingExtractionProviderResult>;
}

export interface MonotonicClock {
  now(): number;
}

export const systemMonotonicClock: MonotonicClock = {
  now: () => performance.now()
};
