import { describe, expect, it } from "vitest";

import { createWorkerMetrics, workerMetricOutcome } from "./metrics.ts";

describe("worker metrics", () => {
  it("renders fixed labels and excludes tenant or payload identifiers", () => {
    const metrics = createWorkerMetrics();
    metrics.observeJob("acquisition", "completed", 125);
    metrics.observeJob("acquisition", "manual_action_required", 40);
    metrics.setReadiness(true);
    const output = metrics.render();

    expect(output).toContain('vera_worker_jobs_total{lane="acquisition",outcome="completed"} 1');
    expect(output).toContain("vera_worker_ready 1");
    expect(output).toContain("# EOF\n");
    expect(output).not.toMatch(/user_id|job_id|listing|email|phone|payload_hash/iu);
  });

  it("clamps unsafe durations and maps runtime statuses into the closed vocabulary", () => {
    const metrics = createWorkerMetrics();
    metrics.observeJob("health", "retryable_failed", Number.POSITIVE_INFINITY);
    metrics.observeJob("health", "retryable_failed", 80_000);
    const output = metrics.render();

    expect(output).toContain(
      'vera_worker_job_duration_milliseconds_sum{lane="health",outcome="retryable_failed"} 60000'
    );
    expect(workerMetricOutcome("deferred_node_offline")).toBe("deferred");
    expect(workerMetricOutcome("unrecognized_status")).toBe("other");
  });
});
