import Link from "next/link";

import { loadCockpitInitialState } from "../lib/cockpit-read-model";
import { DemoSearch } from "./demo-search";

export default function HomePage() {
  const initialState = loadCockpitInitialState();

  return (
    <main className="cockpit-main">
      <header className="cockpit-hero">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="eyebrow">Vera · renter-controlled search</span>
          <nav className="home-nav" aria-label="Vera navigation">
            <Link href="/">Inbox</Link>
            <Link href="/capture">Capture a listing</Link>
            <Link href="/activity">Activity</Link>
            <Link href="/connectors">Source status</Link>
          </nav>
        </div>
        <div className="cockpit-hero-copy">
          <div>
            <p className="kicker">Find fast. Rent safely.</p>
            <h1>Your housing options, already organized.</h1>
          </div>
          <p className="lede">
            Vera turns fragmented listings into one evidence-backed inbox, so you can compare fit,
            missing facts, duplicate sources, and risk indicators without surrendering control.
          </p>
        </div>
        <div className="cockpit-principles" aria-label="Vera decision principles">
          <span>Deterministic fit</span>
          <span>Every source retained</span>
          <span>No autonomous outreach</span>
        </div>
      </header>

      <DemoSearch initialState={initialState} />

      <section className="next-step cockpit-safety" aria-labelledby="next-step-heading">
        <p className="eyebrow">Your decision, not an autonomous action</p>
        <h2 id="next-step-heading">Evidence first. Outreach comes next.</h2>
        <p>
          This offline demo uses sanitized fixtures only. It does not connect to marketplace
          accounts, send messages, create applications, or make payments.
        </p>
      </section>
    </main>
  );
}
