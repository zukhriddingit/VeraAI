import styles from "../../legal-page.module.css";

export const metadata = {
  title: "Browser Connector Privacy | Vera",
  description: "The exact data boundary for Vera's private-beta browser connector."
};

export default function BrowserConnectorPrivacyPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/"><span aria-hidden="true">V</span>Vera</a>
        <a href="/privacy">General privacy</a>
      </nav>
      <article className={styles.article}>
        <p className={styles.eyebrow}>Effective August 13, 2026</p>
        <h1>One tab. Explicitly shared.</h1>
        <p className={styles.lede}>
          Vera Housing operates Vera Browser Connector for approved private-beta testers. Questions,
          access requests, or deletion requests can be sent to <a href="mailto:support@verahousing.app">support@verahousing.app</a>.
        </p>
        <section>
          <h2>What the connector stores locally</h2>
          <p>
            Chrome stores the paired relay endpoint, one scoped relay credential, and the visible
            Vera tab-group color. Unpair removes the local relay credential and closes the connection.
          </p>
        </section>
        <section>
          <h2>What may be processed</h2>
          <p>
            After you choose to share exactly one tab and trigger research, Vera may process that
            tab URL and observed page content needed to identify housing cards, observed same-source
            links, photos, price, fees, availability, and amenities. Data moves over HTTPS and WSS.
            Imported listing facts, source links, provenance, and audit-safe activity metadata may be
            retained in your Vera account.
          </p>
        </section>
        <section>
          <h2>What is excluded</h2>
          <p>
            Cookies, saved passwords, browser storage, authenticated request headers, full-page
            screenshots, and unrelated browsing are excluded from listing output. Vera does not ask
            for or type credentials and stops for login, 2FA, CAPTCHA, consent, checkpoints, blocking,
            and changed layouts.
          </p>
        </section>
        <section>
          <h2>Use and transfer</h2>
          <p>
            Vera uses essential hosting, database, and Gateway providers to deliver the requested
            feature. We do not sell Chrome data, use it for advertising or creditworthiness, or
            transfer it for an unrelated purpose. A human may inspect a minimized support record only
            with your specific support consent, when necessary for security, when required by law, or
            in aggregated or anonymized operations.
          </p>
          <p className={styles.callout}>
            Vera Browser Connector&apos;s use and transfer of information received from Chrome APIs
            adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
          </p>
        </section>
        <section>
          <h2>Your controls</h2>
          <p>
            Unsharing stops future tab access. You can unpair at any time, correct Vera account data,
            request an export, or request deletion. Account deletion also revokes Vera&apos;s server-side
            browser assignment after the self-service lifecycle is production-verified.
          </p>
        </section>
      </article>
    </main>
  );
}
