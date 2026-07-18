import Link from "next/link";

import { ActivityTimeline } from "./activity-timeline";

export default function ActivityPage() {
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
      <ActivityTimeline />
    </main>
  );
}
