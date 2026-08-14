import type { Metadata } from "next";

import { BetaAccessForm } from "./beta-access-form.tsx";
import styles from "./beta-access.module.css";

export const metadata: Metadata = {
  title: "Join Vera's private beta",
  description: "Request an invitation to Vera's founder-supported private beta."
};

export default function BetaAccessPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="https://verahousing.app" aria-label="Vera marketing home">
          <span aria-hidden="true">V</span>
          Vera
        </a>
        <a href="/sign-in">Already invited? Sign in</a>
      </header>

      <section className={styles.content}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Founder-supported private beta</p>
          <h1>Search faster without giving up control.</h1>
          <p className={styles.lede}>
            Vera turns fragmented rental listings into one evidence-backed inbox. It keeps sources,
            missing facts, risk indicators, and every external action visible.
          </p>
          <ul>
            <li>Real listing discovery with retained provenance</li>
            <li>Deterministic fit scores you can inspect</li>
            <li>Read-only browser research for approved testers</li>
            <li>No autonomous outreach, applications, or payments</li>
          </ul>
        </div>

        <div className={styles.formPanel}>
          <p>REQUEST ACCESS</p>
          <h2>Start with your email.</h2>
          <p>
            We are inviting a small number of renters so we can support each setup closely. A
            request does not create an account or approve access.
          </p>
          <BetaAccessForm />
        </div>
      </section>
    </main>
  );
}
