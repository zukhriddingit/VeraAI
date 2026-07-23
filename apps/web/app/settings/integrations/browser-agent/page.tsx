import Link from "next/link";

import { getBrowserAgentStatus } from "../../../../lib/browser-agent-service.ts";
import { requireVeraPageSession } from "../../../../lib/server/page-session.ts";
import { parseHostedRuntimePolicy } from "../../../../lib/server/hosted-runtime-policy.ts";
import { BrowserAgentPanel } from "./browser-agent-panel.tsx";

export const dynamic = "force-dynamic";

export default async function BrowserAgentSettingsPage() {
  const context = await requireVeraPageSession();
  const status = await getBrowserAgentStatus({
    repositories: context.repositories,
    systemBrowserDisabled: parseHostedRuntimePolicy(process.env).browserDisabled,
    now: () => new Date(),
    createId: crypto.randomUUID
  });
  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/demo">Listings</Link>
        <Link href="/settings/integrations">Integrations</Link>
        <Link href="/settings/integrations/browser-agent" aria-current="page">
          Browser agent
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Settings · Integrations · Browser agent</p>
        <h1>Capture one page you already opened.</h1>
        <p className="lede">
          This unsupported founder experiment reads only the current exact Zillow listing tab in
          your selected local OpenClaw profile. Vera&apos;s adapter requests no navigation,
          messaging, application, payment, or blocker-bypass actions. The underlying founder-only
          OpenClaw browser proxy is an administrative capability and remains disabled by default.
        </p>
      </header>
      <BrowserAgentPanel initialStatus={status} />
    </main>
  );
}
