import Link from "next/link";

import { loadCockpitInitialState } from "../lib/cockpit-read-model";
import { DemoSearch } from "./demo-search";

export default function HomePage() {
  const initialState = loadCockpitInitialState();

  return (
    <main>
      <header className="hero demo-hero">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="eyebrow">Vera · renter-controlled search</span>
          <nav className="home-nav" aria-label="Vera navigation">
            <Link href="/">Listings</Link>
            <Link href="/capture">Capture a listing</Link>
            <Link href="/activity">Activity</Link>
            <Link href="/connectors">Connector status</Link>
          </nav>
        </div>
        <div className="hero-copy">
          <p className="kicker">Find fast. Rent safely.</p>
          <h1>Know which home deserves your attention.</h1>
          <p className="lede">
            Vera preserves source evidence, recognizes duplicate listings, and explains fit and
            risk—while every real-world action stays under your control.
          </p>
        </div>
      </header>

      <DemoSearch initialState={initialState} />

      <section className="next-step" aria-labelledby="next-step-heading">
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
