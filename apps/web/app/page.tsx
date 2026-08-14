import Link from "next/link";

import type { RentalResearchSource } from "@vera/domain";

import { loadCockpitInitialState } from "../lib/cockpit-read-model";
import { parseLiveSearchEnvironment } from "../lib/live-search-service";
import { getHostedApplication } from "../lib/server/application";
import { requireVeraPageSession } from "../lib/server/page-session";
import { DemoSearch } from "./demo-search";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const context = await requireVeraPageSession();
  const initialState = await loadCockpitInitialState(context.repositories, context.demoMode);
  const liveSearchPreview = process.env.VERA_E2E_LIVE_SEARCH_UI === "1";
  const availableLiveSources: RentalResearchSource[] = [];
  if (liveSearchPreview) {
    availableLiveSources.push(
      "rentcast",
      "zillow",
      "apartments_com",
      "facebook_marketplace",
      "bu_off_campus",
      "craigslist",
      "custom_website"
    );
  } else if (!context.demoMode) {
    const liveEnvironment = parseLiveSearchEnvironment(process.env);
    if (liveEnvironment.enabled && liveEnvironment.founderUserIds.has(context.userId)) {
      availableLiveSources.push("rentcast");
    }
    const application = getHostedApplication();
    const browserRuntime =
      (await application.browserGatewayRuntime?.resolveForUser(context.userId)) ?? null;
    if (browserRuntime) availableLiveSources.push(...browserRuntime.enabledSources);
  }

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
            <Link href="/settings/integrations">Settings</Link>
            <SignOutButton />
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

      <DemoSearch
        initialState={initialState}
        liveSearchPreview={liveSearchPreview}
        availableLiveSources={availableLiveSources}
      />

      <section className="next-step cockpit-safety" aria-labelledby="next-step-heading">
        <p className="eyebrow">Your decision, not an autonomous action</p>
        <h2 id="next-step-heading">Evidence first. Outreach comes next.</h2>
        <p>
          {context.demoMode
            ? "This offline demo uses sanitized fixtures only. It does not connect to marketplace accounts, send messages, create applications, or make payments."
            : "Live RentCast search is read-only and founder-triggered. OpenClaw analyzes minimized candidate facts only; Vera does not browse, contact landlords, send messages, create applications, or make payments."}
        </p>
      </section>
    </main>
  );
}
