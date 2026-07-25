import Link from "next/link";

import { requireVeraPageSession } from "../../../../lib/server/page-session.ts";
import { parseRemoteExtensionSnapshotEnvironment } from "../../../../lib/remote-extension-snapshot-service.ts";
import { RemoteBrowserPanel } from "./remote-browser-panel.tsx";

export const dynamic = "force-dynamic";

export default async function RemoteBrowserSettingsPage() {
  const context = await requireVeraPageSession();
  const environment = parseRemoteExtensionSnapshotEnvironment(process.env);
  const available =
    !context.demoMode &&
    environment.enabled &&
    !environment.browserDisabled &&
    environment.gatewayConfigured &&
    environment.founderUserId === context.userId;

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/integrations">Integrations</Link>
        <Link href="/settings/integrations/remote-browser" aria-current="page">
          Remote browser
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Founder experiment · connectivity only</p>
        <h1>Share one tab. Vera only reads.</h1>
        <p className="lede">
          The official OpenClaw Chrome extension connects directly to your dedicated Maritime
          Gateway over WSS. Put exactly one tab in the OpenClaw tab group, then request one
          minimized snapshot. This spike cannot navigate, click, type, submit, message, download,
          upload, apply, or pay.
        </p>
      </header>
      <RemoteBrowserPanel available={available} />
    </main>
  );
}
