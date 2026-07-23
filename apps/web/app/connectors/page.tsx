import Link from "next/link";

import { requireVeraPageSession } from "../../lib/server/page-session";
import { ConnectorStatusList } from "./connector-status";

export default async function ConnectorsPage() {
  await requireVeraPageSession();
  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/demo">Vera dashboard</Link>
        <Link href="/capture">Capture a listing</Link>
        <Link href="/activity">Activity</Link>
      </nav>
      <header className="subpage-hero">
        <p className="eyebrow">Source policy</p>
        <h1>Every connector starts closed.</h1>
        <p className="lede">
          Vera enables only the local capabilities listed below. A URL is provenance, not permission
          to browse, fetch, or follow it.
        </p>
      </header>
      <section className="connector-section" aria-labelledby="connector-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">Health and capability</p>
            <h2 id="connector-heading">Connector status</h2>
          </div>
        </div>
        <ConnectorStatusList />
        <aside className="policy-note">
          <h2>Unknown domains stay manual.</h2>
          <p>
            Vera classifies an unfamiliar public hostname as <strong>other</strong>. It may be
            stored with user-supplied content, but future browser access requires a separate,
            explicit manual policy entry and review.
          </p>
        </aside>
      </section>
    </main>
  );
}
