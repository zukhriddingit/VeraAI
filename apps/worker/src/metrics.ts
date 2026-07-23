export const WORKER_METRIC_LANES = [
  "schedule",
  "acquisition",
  "normalization",
  "decision",
  "notification",
  "health"
] as const;

export const WORKER_METRIC_OUTCOMES = [
  "idle",
  "completed",
  "deferred",
  "manual_action_required",
  "retryable_failed",
  "permanently_failed",
  "cancelled_by_policy",
  "other"
] as const;

export type WorkerMetricLane = (typeof WORKER_METRIC_LANES)[number];
export type WorkerMetricOutcome = (typeof WORKER_METRIC_OUTCOMES)[number];

const DURATION_BUCKETS = [10, 50, 100, 250, 500, 1_000, 5_000, 15_000, 30_000] as const;

interface MetricCell {
  count: number;
  sum: number;
  readonly buckets: number[];
}

export interface WorkerMetrics {
  observeJob(
    lane: WorkerMetricLane,
    outcome: WorkerMetricOutcome,
    durationMilliseconds: number
  ): void;
  setReadiness(ready: boolean): void;
  render(): string;
}

function key(lane: WorkerMetricLane, outcome: WorkerMetricOutcome): string {
  return `${lane}:${outcome}`;
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(value, 60_000);
}

export function workerMetricOutcome(status: string): WorkerMetricOutcome {
  switch (status) {
    case "idle":
      return "idle";
    case "completed":
    case "succeeded":
    case "replayed":
      return "completed";
    case "deferred_node_offline":
    case "deferred_quiet_hours":
    case "deferred_rate_limit":
      return "deferred";
    case "manual_action_required":
      return "manual_action_required";
    case "retryable_failed":
      return "retryable_failed";
    case "dead_letter":
    case "permanently_failed":
      return "permanently_failed";
    case "cancelled":
    case "cancelled_by_policy":
      return "cancelled_by_policy";
    default:
      return "other";
  }
}

export function createWorkerMetrics(): WorkerMetrics {
  const cells = new Map<string, MetricCell>();
  for (const lane of WORKER_METRIC_LANES) {
    for (const outcome of WORKER_METRIC_OUTCOMES) {
      cells.set(key(lane, outcome), {
        count: 0,
        sum: 0,
        buckets: DURATION_BUCKETS.map(() => 0)
      });
    }
  }
  let ready = false;

  return {
    observeJob(lane, outcome, durationInput) {
      const duration = boundedDuration(durationInput);
      const cell = cells.get(key(lane, outcome));
      if (!cell) throw new TypeError("Worker metric label is outside the fixed vocabulary.");
      cell.count += 1;
      cell.sum += duration;
      for (const [index, boundary] of DURATION_BUCKETS.entries()) {
        if (duration <= boundary) cell.buckets[index] = (cell.buckets[index] ?? 0) + 1;
      }
    },
    setReadiness(value) {
      ready = value;
    },
    render() {
      const lines = [
        "# HELP vera_worker_jobs_total Worker lane outcomes.",
        "# TYPE vera_worker_jobs_total counter"
      ];
      for (const lane of WORKER_METRIC_LANES) {
        for (const outcome of WORKER_METRIC_OUTCOMES) {
          const cell = cells.get(key(lane, outcome));
          if (!cell) throw new Error("Worker metric registry is incomplete.");
          const labels = `lane="${lane}",outcome="${outcome}"`;
          lines.push(`vera_worker_jobs_total{${labels}} ${cell.count}`);
        }
      }
      lines.push(
        "# HELP vera_worker_job_duration_milliseconds Worker lane duration in milliseconds.",
        "# TYPE vera_worker_job_duration_milliseconds histogram"
      );
      for (const lane of WORKER_METRIC_LANES) {
        for (const outcome of WORKER_METRIC_OUTCOMES) {
          const cell = cells.get(key(lane, outcome));
          if (!cell) throw new Error("Worker metric registry is incomplete.");
          const labels = `lane="${lane}",outcome="${outcome}"`;
          for (const [index, boundary] of DURATION_BUCKETS.entries()) {
            lines.push(
              `vera_worker_job_duration_milliseconds_bucket{${labels},le="${boundary}"} ${cell.buckets[index] ?? 0}`
            );
          }
          lines.push(
            `vera_worker_job_duration_milliseconds_bucket{${labels},le="+Inf"} ${cell.count}`,
            `vera_worker_job_duration_milliseconds_sum{${labels}} ${cell.sum}`,
            `vera_worker_job_duration_milliseconds_count{${labels}} ${cell.count}`
          );
        }
      }
      lines.push(
        "# HELP vera_worker_ready Whether PostgreSQL-backed readiness last succeeded.",
        "# TYPE vera_worker_ready gauge",
        `vera_worker_ready ${ready ? 1 : 0}`,
        "# EOF"
      );
      return `${lines.join("\n")}\n`;
    }
  };
}
