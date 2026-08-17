import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { SettingsNav } from "../settings-nav.tsx";
import { PrivacyControls } from "./privacy-controls.tsx";

export const dynamic = "force-dynamic";

export default async function PrivacySettingsPage() {
  const context = await requireVeraPageSession();

  return (
    <main>
      <SettingsNav current="privacy" />
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Settings · Privacy</p>
        <h1>Your account data, under your control.</h1>
        <p className="lede">
          Export a portable copy or permanently delete your Vera account through an authenticated,
          two-step flow.
        </p>
      </header>

      <section className="settings-section" aria-label="Privacy controls">
        {context.demoMode ? (
          <article className="settings-account-card">
            <div>
              <p className="eyebrow">Offline demo</p>
              <h2>Privacy controls are unavailable in demo mode.</h2>
              <p>
                The deterministic demo uses sanitized fixtures and has no hosted account to export
                or delete.
              </p>
            </div>
          </article>
        ) : (
          <PrivacyControls />
        )}
      </section>
    </main>
  );
}
