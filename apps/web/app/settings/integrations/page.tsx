import { getCalendarIntegrationStatus } from "../../../lib/calendar-service.ts";
import { getGmailIntegrationStatus } from "../../../lib/gmail-integration-status.ts";
import { getHostedApplication } from "../../../lib/server/application.ts";
import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { IntegrationCards } from "./integration-cards.tsx";
import { GmailIntegrationCard } from "./gmail-integration-card.tsx";
import { SettingsNav } from "../settings-nav.tsx";
import Link from "next/link";

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
      <SettingsNav current="integrations" />
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
      <section className="settings-section" aria-labelledby="remote-browser-link-heading">
        <article className="integration-card">
          <p className="eyebrow">Founder connectivity experiment</p>
          <h2 id="remote-browser-link-heading">Remote consent-tab connector</h2>
          <p>
            Pair the official Chrome extension directly to a dedicated Maritime Gateway and request
            one minimized read-only snapshot from a tab you explicitly share.
          </p>
          <Link
            className="secondary-button compact-button"
            href="/settings/integrations/remote-browser"
          >
            Open remote browser connector
          </Link>
        </article>
      </section>
    </main>
  );
}
