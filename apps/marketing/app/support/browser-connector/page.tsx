import styles from "../../legal-page.module.css";

export const metadata = { title: "Browser Connector Support | Vera" };

export default function BrowserConnectorSupportPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          <span aria-hidden="true">V</span>Vera
        </a>
        <a href="/support">General support</a>
      </nav>
      <article className={styles.article}>
        <p className={styles.eyebrow}>Approved testers only</p>
        <h1>Keep the browser boundary visible.</h1>
        <p className={styles.lede}>
          For Browser Connector help, email{" "}
          <a href="mailto:support@verahousing.app">support@verahousing.app</a>.
        </p>
        <section>
          <h2>Safe setup</h2>
          <ol>
            <li>Verify your approved Vera beta access.</li>
            <li>
              Sign in to Vera, open Browser Connector settings, and choose Connect this browser.
            </li>
            <li>Confirm that connecting alone shares zero tabs.</li>
            <li>Prepare one dedicated Vera Search tab.</li>
            <li>Confirm Vera reports Browser ready.</li>
            <li>Handle login, 2FA, CAPTCHA, checkpoints, and consent manually.</li>
            <li>
              Unshare when research is complete; revoke browser access when you are done testing.
            </li>
          </ol>
        </section>
        <section>
          <h2>Never email private browser material</h2>
          <p>
            Never send support a password, cookie, enrollment ticket, relay credential, browser
            profile, raw page snapshot, authenticated header, payment, or identity document. Vera
            support will not ask for them.
          </p>
        </section>
      </article>
    </main>
  );
}
