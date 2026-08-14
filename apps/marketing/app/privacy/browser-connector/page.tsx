import styles from "../../legal-page.module.css";

export const metadata = {
  title: "Browser Connector Privacy | Vera",
  description: "The exact data boundary for Vera's private-beta browser connector."
};

export default function BrowserConnectorPrivacyPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          <span aria-hidden="true">V</span>Vera
        </a>
        <a href="/privacy">General privacy</a>
      </nav>
      <article className={styles.article}>
        <p className={styles.eyebrow}>Private-beta browser connector</p>
        <h1>One tab. Explicitly shared.</h1>
        <p className={styles.lede}>
          Vera Browser Connector lets an approved tester deliberately share one dedicated housing
          search tab with that tester&apos;s paired Vera Browser Gateway.
        </p>

        <section>
          <h2>What may be processed</h2>
          <p>
            While a tab is shared and the tester triggers research, Vera may process the tab URL and
            observed page content needed to identify rental cards, same-source listing links, and
            observed listing facts such as photos, price, availability, fees, and amenities.
          </p>
        </section>
        <section>
          <h2>What is not listing output</h2>
          <p>
            Cookies, saved passwords, browser storage, authenticated request headers, and full-page
            screenshots are not retained as listing output. Vera does not ask for or type
            third-party credentials and does not automate login, 2FA, CAPTCHA, or consent.
          </p>
        </section>
        <section>
          <h2>Read-only and bounded</h2>
          <p className={styles.callout}>
            Vera never clicks Contact, Apply, Tour, Reply, Message, Email, Phone, payment, upload,
            download, or posting controls. It stops visibly for login, CAPTCHA, consent,
            rate-limiting, blocking, and changed layouts.
          </p>
          <p>
            Research stays on source-policy-approved domains, respects source and run limits, and is
            user-triggered only. Browser sources are experimental personal capabilities, not a
            production-supported public service.
          </p>
        </section>
        <section>
          <h2>Control and revocation</h2>
          <p>
            The shared tab remains visibly labeled. Unsharing prevents future browser work;
            unpairing removes the local relay connection. Server-side beta access can also be
            revoked. For questions or deletion requests, contact{" "}
            <a href="mailto:support@verahousing.app">support@verahousing.app</a>.
          </p>
        </section>
      </article>
    </main>
  );
}
