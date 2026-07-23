"use client";

import type { OperationsSnapshot, SourceJobStatus } from "@vera/domain";
import { useState } from "react";

interface ControllableJob {
  readonly id: string;
  readonly status: SourceJobStatus;
  readonly attempts: number;
  readonly source: string;
  readonly canRetry: boolean;
}

export function OperationsPanel(props: {
  readonly snapshot: OperationsSnapshot;
  readonly jobs: readonly ControllableJob[];
}) {
  const [jobs, setJobs] = useState(props.jobs);
  const [message, setMessage] = useState<string | null>(null);

  async function control(job: ControllableJob, operation: "retry" | "cancel") {
    setMessage(null);
    const correlationId = crypto.randomUUID();
    const response = await fetch(
      `/api/operations/jobs/${encodeURIComponent(job.id)}/${operation}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: job.attempts, correlationId })
      }
    );
    const body = (await response.json()) as {
      status?: SourceJobStatus;
      attempts?: number;
      code?: string;
    };
    if (!response.ok || !body.status) {
      setMessage(`Job control denied safely: ${body.code ?? "unknown_error"}.`);
      return;
    }
    setJobs((current) =>
      current.map((candidate) =>
        candidate.id === job.id
          ? {
              ...candidate,
              status: body.status as SourceJobStatus,
              attempts: body.attempts ?? candidate.attempts
            }
          : candidate
      )
    );
    setMessage(`Job ${job.id} is now ${body.status}.`);
  }

  return (
    <div className="settings-section">
      <section className="integration-card-grid" aria-label="Service health">
        <article className="integration-card">
          <p className="eyebrow">Vera worker</p>
          <h2>{props.snapshot.worker.status}</h2>
          <p>Checked {new Date(props.snapshot.worker.checkedAt).toLocaleString()}</p>
        </article>
        <article className="integration-card">
          <p className="eyebrow">Maritime</p>
          <h2>{props.snapshot.maritime.status}</h2>
          <p>{props.snapshot.maritime.safeCode ?? "API status confirmed"}</p>
        </article>
        <article className="integration-card">
          <p className="eyebrow">OpenClaw gateway</p>
          <h2>{props.snapshot.gateway.status}</h2>
          <p>Version {props.snapshot.gateway.version}</p>
        </article>
        <article className="integration-card">
          <p className="eyebrow">Browser node</p>
          <h2>{props.snapshot.browserNode?.status ?? "not configured"}</h2>
          <p>{props.snapshot.browserNode?.pairingState ?? "No founder node"}</p>
        </article>
      </section>

      <article className="integration-card">
        <h2>Canonical job counts</h2>
        <p>
          Queued {props.snapshot.jobCounts.queued} · Running {props.snapshot.jobCounts.running} ·
          Deferred {props.snapshot.jobCounts.deferred} · Manual action{" "}
          {props.snapshot.jobCounts.manualAction} · Dead letter{" "}
          {props.snapshot.jobCounts.deadLetter}
        </p>
        <p>
          Notifications: {props.snapshot.notificationCounts.queued} queued ·{" "}
          {props.snapshot.notificationCounts.delivered} delivered ·{" "}
          {props.snapshot.notificationCounts.failed} failed
        </p>
      </article>

      <article className="integration-card">
        <h2>Triggers and schedules</h2>
        {props.snapshot.schedules.length === 0 ? (
          <p>No production schedules configured.</p>
        ) : (
          props.snapshot.schedules.map((schedule) => (
            <p key={`${schedule.kind}:${schedule.nextRunAt}`}>
              <strong>{schedule.kind}</strong> — {schedule.state}; next{" "}
              {new Date(schedule.nextRunAt).toLocaleString()}; last{" "}
              {schedule.lastOutcome ?? "never"}
            </p>
          ))
        )}
      </article>

      <article className="integration-card">
        <h2>Failed and blocked jobs</h2>
        {jobs.length === 0 ? (
          <p>No retryable, deferred, manual-action, or active jobs.</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="operations-job-row">
              <span>
                {job.source} · {job.status} · attempt {job.attempts}
              </span>
              {job.canRetry ? (
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => void control(job, "retry")}
                >
                  Retry safely
                </button>
              ) : null}
              {!new Set(["completed", "permanently_failed", "cancelled_by_policy"]).has(
                job.status
              ) ? (
                <button
                  type="button"
                  className="secondary-button compact-button"
                  onClick={() => void control(job, "cancel")}
                >
                  Cancel by policy
                </button>
              ) : null}
            </div>
          ))
        )}
      </article>

      <article className="integration-card">
        <h2>Source kill switches</h2>
        {props.snapshot.killSwitches.map((item) => (
          <p key={item.source}>
            {item.source}: {item.enabled ? "kill switch active" : "permitted by current manifest"}
          </p>
        ))}
      </article>
      {message ? (
        <p role="status" className="settings-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}
