import Link from "next/link";

import { getActivityCollection } from "../../lib/listing-presentation";
import { requireVeraPageSession } from "../../lib/server/page-session";
import { ActivityTimeline } from "./activity-timeline";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const context = await requireVeraPageSession();
  let activity: Awaited<ReturnType<typeof getActivityCollection>> | null = null;
  try {
    activity = await getActivityCollection(context.repositories);
  } catch {
    activity = null;
  }

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/demo">Listings</Link>
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
          Activity history is unavailable. Check Vera database readiness.
        </div>
      )}
    </main>
  );
}
