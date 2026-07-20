import { describe, expect, it } from "vitest";

import { createAlternatingWorkerRuntime } from "./decision-runtime.ts";

describe("alternating worker runtime", () => {
  it("alternates normalization and decision work without starvation", async () => {
    const calls: string[] = [];
    const runtime = createAlternatingWorkerRuntime({
      async processNormalization() {
        calls.push("normalization");
        return { status: "idle" };
      },
      async processDecision() {
        calls.push("decision");
        return { status: "idle" };
      }
    });
    const signal = new AbortController().signal;

    await runtime.processNext(signal);
    await runtime.processNext(signal);
    await runtime.processNext(signal);
    await runtime.processNext(signal);

    expect(calls).toEqual(["normalization", "decision", "normalization", "decision"]);
  });
});
