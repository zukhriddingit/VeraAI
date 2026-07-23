import Link from "next/link";

import { requireVeraPageSession } from "../../lib/server/page-session";
import { CaptureForm } from "./capture-form";

export default async function CapturePage() {
  await requireVeraPageSession();
  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Vera dashboard</Link>
        <Link href="/activity">Activity</Link>
        <Link href="/connectors">Connector status</Link>
      </nav>
      <header className="subpage-hero">
        <p className="eyebrow">Manual capture</p>
        <h1>Bring the evidence. Keep control.</h1>
        <p className="lede">
          Paste listing content you already have. Vera records the URL as provenance but never opens
          it, follows it, or downloads from it.
        </p>
      </header>
      <section className="capture-section" aria-labelledby="capture-heading">
        <div className="section-heading compact-heading">
          <div>
            <p className="eyebrow">No network access</p>
            <h2 id="capture-heading">Capture a listing</h2>
          </div>
        </div>
        <CaptureForm />
      </section>
    </main>
  );
}
