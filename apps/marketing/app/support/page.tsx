import styles from "../legal-page.module.css";

export const metadata = { title: "Support | Vera" };

export default function SupportPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          <span aria-hidden="true">V</span>Vera
        </a>
        <a href="/">Back to Vera</a>
      </nav>
      <article className={styles.article}>
        <p className={styles.eyebrow}>Private-beta support</p>
        <h1>Tell us what stopped you.</h1>
        <p className={styles.lede}>
          For beta access, account privacy, or browser connector help, email{" "}
          <a href="mailto:support@verahousing.app">support@verahousing.app</a>.
        </p>
        <section>
          <h2>Browser safety blockers remain manual</h2>
          <p>
            If a housing site shows login, 2FA, CAPTCHA, consent, a checkpoint, or a changed layout,
            Vera will stop. Complete the prompt manually if you choose, keep exactly one dedicated
            tab shared, then retry from Vera.
          </p>
        </section>
        <section>
          <h2>Never send a password or pairing credential</h2>
          <p>
            Support will never ask you to email a marketplace password, cookie, one-time pairing
            value, payment, or identity document.
          </p>
        </section>
      </article>
    </main>
  );
}
