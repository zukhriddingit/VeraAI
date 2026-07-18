"use client";

import { HealthReportSchema, type HealthReport } from "@vera/domain";
import { useEffect, useState } from "react";

type HealthState =
  { kind: "loading" } | { kind: "online"; report: HealthReport } | { kind: "unavailable" };

export function DashboardHealth() {
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Health endpoint returned a non-success status.");
        }

        const payload: unknown = await response.json();
        const report = HealthReportSchema.parse(payload);
        setHealth({ kind: "online", report });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setHealth({ kind: "unavailable" });
      }
    }

    void loadHealth();

    return () => {
      controller.abort();
    };
  }, []);

  if (health.kind === "online") {
    return (
      <div className="health-pill health-pill-online" role="status" aria-live="polite">
        <span className="health-dot" aria-hidden="true" />
        <span>
          <strong>Online</strong>
          <small>API · Node {health.report.runtime.node}</small>
        </span>
      </div>
    );
  }

  if (health.kind === "unavailable") {
    return (
      <div className="health-pill health-pill-unavailable" role="status" aria-live="polite">
        <span className="health-dot" aria-hidden="true" />
        <span>
          <strong>Unavailable</strong>
          <small>Check the local web process</small>
        </span>
      </div>
    );
  }

  return (
    <div className="health-pill" role="status" aria-live="polite">
      <span className="health-dot" aria-hidden="true" />
      <span>
        <strong>Checking</strong>
        <small>Contacting the local API</small>
      </span>
    </div>
  );
}
