"use client";

import { ActivityCollectionResponseSchema, type ActivityCollectionResponse } from "@vera/domain";
import { useEffect, useState } from "react";

type ActivityState =
  { kind: "loading" } | { kind: "ready"; activity: ActivityCollectionResponse } | { kind: "error" };
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function ActivityTimeline() {
  const [state, setState] = useState<ActivityState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/activity", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("activity unavailable");
        setState({
          kind: "ready",
          activity: ActivityCollectionResponseSchema.parse((await response.json()) as unknown)
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <div className="listing-message">Loading activity…</div>;
  if (state.kind === "error")
    return (
      <div className="listing-message listing-message-warning">
        Activity history is unavailable.
      </div>
    );

  return (
    <section className="activity-section" aria-labelledby="activity-heading">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{state.activity.count} immutable events</p>
          <h2 id="activity-heading">Activity log</h2>
        </div>
      </div>
      <div className="activity-list">
        {state.activity.events.map((event) => (
          <article className="activity-row activity-row-full" key={event.id}>
            <div>
              <span className={`activity-outcome activity-outcome-${event.outcome}`}>
                {event.outcome}
              </span>
              <h3>{event.action}</h3>
            </div>
            <time dateTime={event.occurredAt}>{date.format(new Date(event.occurredAt))}</time>
            <p>{event.detail ?? `${event.targetType.replaceAll("_", " ")} · ${event.targetId}`}</p>
            <small>Correlation {event.correlationId}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
