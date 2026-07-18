import { describe, expect, it } from "vitest";

import {
  ActivityCollectionResponseSchema,
  DEMO_SEARCH_COMPLETION_SUMMARY,
  DemoRunResponseSchema,
  DemoStatusResponseSchema,
  ShortlistResponseSchema
} from "./demo-api.ts";

const timestamp = "2026-07-17T12:20:00.000Z";

describe("demo API schemas", () => {
  it("accepts only the exact deterministic completion summary", () => {
    const response = DemoRunResponseSchema.parse({
      status: "completed",
      sourceRecordsAnalyzed: 12,
      homesFound: 8,
      duplicateClusters: 3,
      summary: DEMO_SEARCH_COMPLETION_SUMMARY,
      completedAt: timestamp,
      idempotentReplay: false
    });

    expect(response.summary).toBe(DEMO_SEARCH_COMPLETION_SUMMARY);
    expect(() => DemoRunResponseSchema.parse({ ...response, homesFound: 9 })).toThrow();
  });

  it("requires status and nullable run summary to agree", () => {
    expect(() =>
      DemoStatusResponseSchema.parse({
        demoMode: true,
        status: "completed",
        profile: {},
        run: null,
        generatedAt: timestamp
      })
    ).toThrow();
  });

  it("rejects inconsistent shortlist state", () => {
    expect(() =>
      ShortlistResponseSchema.parse({
        listingId: "can-test",
        lifecycleState: "new",
        shortlisted: true,
        activityEventId: "event-test",
        updatedAt: timestamp
      })
    ).toThrow();
  });

  it("requires activity count to match", () => {
    expect(() =>
      ActivityCollectionResponseSchema.parse({ events: [], count: 1, generatedAt: timestamp })
    ).toThrow();
  });
});
