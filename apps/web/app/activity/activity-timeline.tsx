import type { ActivityCollectionResponse } from "@vera/domain";

const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function ActivityTimeline({ activity }: { activity: ActivityCollectionResponse }) {
  return (
    <section className="activity-section" aria-labelledby="activity-heading">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">{activity.count} immutable events</p>
          <h2 id="activity-heading">Activity log</h2>
        </div>
      </div>
      {activity.events.length === 0 ? (
        <div className="filter-empty-state">
          <strong>No material actions yet.</strong>
          <p>
            Run the fixture search or make a renter-controlled decision to begin the audit trail.
          </p>
        </div>
      ) : (
        <div className="activity-list">
          {activity.events.map((event) => (
            <article className="activity-row activity-row-full" key={event.id}>
              <div>
                <span className={`activity-outcome activity-outcome-${event.outcome}`}>
                  {event.outcome}
                </span>
                <h3>{event.action}</h3>
              </div>
              <time dateTime={event.occurredAt}>{date.format(new Date(event.occurredAt))}</time>
              <p>
                {event.detail ?? `${event.targetType.replaceAll("_", " ")} · ${event.targetId}`}
              </p>
              <small>Correlation {event.correlationId}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
