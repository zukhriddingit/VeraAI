import Link from "next/link";

import { getCalendarIntegrationStatus } from "../../../lib/calendar-service.ts";
import { getGmailIntegrationStatus } from "../../../lib/gmail-integration-status.ts";
import { getHostedApplication } from "../../../lib/server/application.ts";
import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { IntegrationCards } from "./integration-cards.tsx";
import { GmailIntegrationCard } from "./gmail-integration-card.tsx";

export const dynamic = "force-dynamic";

export default async function IntegrationsSettingsPage() {
  const application = getHostedApplication();
  const context = await requireVeraPageSession();
  const status = await getCalendarIntegrationStatus(
    context.repositories,
    application.calendar.configurationState,
    new Date().toISOString()
  );
  const gmailStatus = await getGmailIntegrationStatus(
    context.repositories,
    application.gmailOAuth !== null
  );

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/integrations" aria-current="page">
          Integrations
        </Link>
        <Link href="/settings/availability">Viewing availability</Link>
        <Link href="/settings/notifications">Notifications</Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Settings · Integrations</p>
        <h1>Connect only what helps.</h1>
        <p className="lede">
          Google Calendar permissions stay separate. Vera asks for conflict checking only when you
          enable it, and private hold access only when you intentionally enable that capability.
        </p>
      </header>

      <IntegrationCards initialStatus={status} />
      <GmailIntegrationCard initialStatus={gmailStatus} />
      <section className="settings-section" aria-labelledby="browser-agent-link-heading">
        <article className="integration-card">
          <p className="eyebrow">Unsupported founder experiment</p>
          <h2 id="browser-agent-link-heading">Local browser agent</h2>
          <p>
            Pair a user-owned OpenClaw node and capture one already-open, exact Zillow listing tab.
          </p>
          <Link
            className="secondary-button compact-button"
            href="/settings/integrations/browser-agent"
          >
            Configure browser agent
          </Link>
        </article>
      </section>
    </main>
  );
}
