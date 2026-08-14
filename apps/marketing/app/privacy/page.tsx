import styles from "../legal-page.module.css";

export const metadata = {
  title: "Privacy | Vera",
  description: "How Vera handles private-beta requests and renter-controlled housing data."
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          <span aria-hidden="true">V</span>Vera
        </a>
        <a href="/">Back to Vera</a>
      </nav>
      <article className={styles.article}>
        <p className={styles.eyebrow}>Privacy notice · August 13, 2026</p>
        <h1>Your housing search remains yours.</h1>
        <p className={styles.lede}>
          Vera is a renter-controlled private-beta product operated by Vera Housing. This notice
          explains the limited information Vera processes, why it is needed, and how to reach us.
        </p>

        <section>
          <h2>Private-beta requests</h2>
          <p>
            When you request access, Vera collects your email address and the version and time of
            your consent. We use it only to review beta participation and contact you about access.
            Submitting a request does not create an account or authorize browser access.
          </p>
        </section>
        <section>
          <h2>Product and housing data</h2>
          <p>
            If invited, Vera may process your search preferences, listing observations, source URLs,
            field-level provenance, deterministic scores, shortlists, risk indicators, and activity
            history. Unknown facts remain unknown. Vera does not sell this data or use it for
            advertising, creditworthiness, or protected-class inference.
          </p>
        </section>
        <section>
          <h2>Google integrations</h2>
          <p>
            Google sign-in identifies invited testers. Optional Gmail and Calendar features use
            narrow, user-approved permissions to prepare a draft or tentative hold. Vera exposes no
            autonomous send path and does not invite a landlord by default.
          </p>
        </section>
        <section>
          <h2>Browser connector</h2>
          <p>
            The browser connector is an experimental private-beta capability with its own prominent
            disclosure. Read the{" "}
            <a href="/privacy/browser-connector">browser connector privacy notice</a>.
          </p>
        </section>
        <section>
          <h2>Infrastructure, retention, and security</h2>
          <p>
            Vera uses service providers needed to host the application, database, approved browser
            gateway, email and calendar integration, and operational monitoring. Access is bounded
            by product policy, audit records, and tenant-scoped repositories. Data is retained only
            as needed to run the beta, protect its integrity, meet legal obligations, and honor
            deletion requests.
          </p>
        </section>
        <section>
          <h2>Your choices</h2>
          <p>
            You may ask to access, correct, export, or delete your Vera data, or withdraw a beta
            request, by emailing{" "}
            <a href="mailto:support@verahousing.app">support@verahousing.app</a>. Self-service
            export and deletion remain unavailable until their production lifecycle and backup
            aging are verified. You can revoke Google access in your Google Account and unshare or
            unpair the browser connector at any time.
          </p>
        </section>
      </article>
    </main>
  );
}
