import { describe, expect, it, vi } from "vitest";

import { LLMCancelledError, LLMInvalidOutputError, LLMRefusalError } from "./errors.ts";
import { MockLLMProvider } from "./mock-provider.ts";
import { GOLDEN_LISTING_REQUEST, createGoldenProviderResult } from "./testing-fixtures.ts";

const controls = () => ({
  signal: new AbortController().signal,
  timeoutMilliseconds: 1_000
});

describe("MockLLMProvider", () => {
  it("returns a schema-validated deep clone and records a cloned request", async () => {
    const result = createGoldenProviderResult();
    const responses = new Map([[GOLDEN_LISTING_REQUEST.inputHash, result]]);
    const provider = new MockLLMProvider({ responses });

    const first = await provider.extract(GOLDEN_LISTING_REQUEST, controls());
    first.extraction.title = {
      status: "unknown",
      value: null,
      confidenceBasisPoints: 0,
      evidenceSnippet: null,
      reason: "not_present"
    };
    const second = await provider.extract(GOLDEN_LISTING_REQUEST, controls());

    expect(second).toEqual(result);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]).toEqual(GOLDEN_LISTING_REQUEST);
    expect(provider.requests[0]).not.toBe(GOLDEN_LISTING_REQUEST);
  });

  it("does not make a network request", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("Network must not be used by the mock provider.");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new MockLLMProvider({
      responses: new Map([[GOLDEN_LISTING_REQUEST.inputHash, createGoldenProviderResult()]])
    });

    await provider.extract(GOLDEN_LISTING_REQUEST, controls());
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects malformed configured output with a typed safe error", async () => {
    const provider = new MockLLMProvider({
      responses: new Map([[GOLDEN_LISTING_REQUEST.inputHash, { malformed: true }]])
    });
    await expect(provider.extract(GOLDEN_LISTING_REQUEST, controls())).rejects.toBeInstanceOf(
      LLMInvalidOutputError
    );
  });

  it("preserves an explicitly simulated typed provider error", async () => {
    const provider = new MockLLMProvider({
      resolver: () => {
        throw new LLMRefusalError({ providerId: "mock", model: "mock-v1" });
      }
    });
    await expect(provider.extract(GOLDEN_LISTING_REQUEST, controls())).rejects.toBeInstanceOf(
      LLMRefusalError
    );
  });

  it("honors a signal that was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new MockLLMProvider({ resolver: () => createGoldenProviderResult() });
    await expect(
      provider.extract(GOLDEN_LISTING_REQUEST, {
        signal: controller.signal,
        timeoutMilliseconds: 1_000
      })
    ).rejects.toBeInstanceOf(LLMCancelledError);
  });

  it("cancels a deterministic pending resolver", async () => {
    const controller = new AbortController();
    const provider = new MockLLMProvider({
      resolver: () => new Promise(() => undefined)
    });
    const pending = provider.extract(GOLDEN_LISTING_REQUEST, {
      signal: controller.signal,
      timeoutMilliseconds: 1_000
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(LLMCancelledError);
  });
});
