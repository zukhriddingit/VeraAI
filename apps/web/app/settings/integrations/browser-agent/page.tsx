import Link from "next/link";

import { approvedBrowserConnectorLink } from "../../../../lib/browser-connector-release.ts";
import { getBrowserAgentStatus } from "../../../../lib/browser-agent-service.ts";
import { getBrowserGatewayOnboardingStatus } from "../../../../lib/browser-gateway-onboarding-service.ts";
import { getHostedApplication } from "../../../../lib/server/application.ts";
import { requireVeraPageSession } from "../../../../lib/server/page-session.ts";
import { parseHostedRuntimePolicy } from "../../../../lib/server/hosted-runtime-policy.ts";
import { BrowserAgentPanel } from "./browser-agent-panel.tsx";

export const dynamic = "force-dynamic";

export default async function BrowserAgentSettingsPage() {
  const context = await requireVeraPageSession();
  const application = getHostedApplication();
  const status = await getBrowserAgentStatus({
    repositories: context.repositories,
    systemBrowserDisabled: parseHostedRuntimePolicy(process.env).browserDisabled,
    now: () => new Date(),
    createId: crypto.randomUUID
  });
  const assignmentStatus = application.browserGatewayAssignments
    ? await getBrowserGatewayOnboardingStatus({
        userId: context.userId,
        assignments: application.browserGatewayAssignments,
        runtimeResolver: application.browserGatewayRuntime,
        repositories: context.repositories
      })
    : null;
  const connectorUrl = approvedBrowserConnectorLink(process.env);
  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/integrations">Integrations</Link>
        <Link href="/settings/integrations/browser-agent" aria-current="page">
          Browser agent
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Settings · Integrations · Browser agent</p>
        <h1>Capture one page you already opened.</h1>
        <p className="lede">
          This private beta reads only an explicitly shared Vera Search tab through your isolated
          Browser Connector assignment. Vera never automates sign-in, CAPTCHA, contact,
          applications, payments, uploads, downloads, or blocker bypasses.
        </p>
      </header>
      {connectorUrl ? (
        <p>
          <a className="primary-action" href={connectorUrl}>
            Install Browser Connector for approved testers
          </a>
        </p>
      ) : (
        <p className="lede">Browser Connector is waiting for concierge onboarding.</p>
      )}
      <BrowserAgentPanel initialStatus={status} initialAssignmentStatus={assignmentStatus} />
    </main>
  );
}
