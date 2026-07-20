import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import Link from "next/link";

import { getActivityCollection } from "../../lib/listing-presentation";
import { ActivityTimeline } from "./activity-timeline";

export const dynamic = "force-dynamic";

export default function ActivityPage() {
  let activity: ReturnType<typeof getActivityCollection> | null = null;
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    connection = openExistingDatabase();
    activity = getActivityCollection(createSqliteRepositories(connection));
  } catch {
    activity = null;
  } finally {
    connection?.close();
  }

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/capture">Capture a listing</Link>
        <Link href="/connectors">Connector status</Link>
      </nav>
      <header className="subpage-hero evidence-hero">
        <p className="eyebrow">Append-only audit history</p>
        <h1>Every material step, visible.</h1>
        <p className="lede">
          Vera records safe action, policy, and outcome metadata without exposing fixture bodies,
          contacts, credentials, or full URLs.
        </p>
      </header>
      {activity ? (
        <ActivityTimeline activity={activity} />
      ) : (
        <div className="listing-message listing-message-warning" role="alert">
          Activity history is unavailable. Run pnpm db:migrate and pnpm db:seed.
        </div>
      )}
    </main>
  );
}
