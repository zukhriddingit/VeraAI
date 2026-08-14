import Image from "next/image";

import { approvedBrowserConnectorLink } from "../lib/browser-connector-release.ts";
import { VERA_BETA_URL, VERA_DEMO_URL } from "../lib/urls.ts";
import { AtlasHero } from "./atlas-hero.tsx";
import styles from "./landing-page.module.css";
import { SectionReveal } from "./section-reveal.tsx";
import { SiteNavigation } from "./site-navigation.tsx";

const sourceModes = [
  { index: "01", name: "Official API", detail: "Reviewed provider access" },
  { index: "02", name: "Email alert", detail: "Provider-supported intake" },
  { index: "03", name: "Local browser", detail: "One explicitly shared tab" },
  { index: "04", name: "User capture", detail: "Evidence you provide" }
] as const;

const evidencePoints = [
  { title: "Source retained", detail: "Every original record remains inspectable." },
  { title: "Unknown visible", detail: "Missing facts stay unknown instead of becoming guesses." },
  { title: "Duplicates stitched", detail: "Matching homes cluster without erasing their origins." },
  { title: "Fit explained", detail: "Deterministic factors show why a home ranked." }
] as const;

const controlPoints = [
  {
    index: "01",
    title: "Fail closed by default",
    detail: "A source or action stays off until Vera's policy explicitly permits it."
  },
  {
    index: "02",
    title: "Evidence before outreach",
    detail: "Known facts, missing information, and risk indicators remain separate and visible."
  },
  {
    index: "03",
    title: "Approval beside the action",
    detail: "Drafts and tentative calendar holds require review of the exact payload."
  },
  {
    index: "04",
    title: "Every material step recorded",
    detail: "Source research, decisions, and policy results appear in the activity history."
  }
] as const;

export default function LandingPage() {
  const connectorUrl = approvedBrowserConnectorLink(process.env);
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <SiteNavigation />

        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Find fast. Rent safely.</p>
            <h1 className={styles.heroTitle} id="landing-title">
              Find a great home faster.
            </h1>
            <p className={styles.heroBody}>
              Vera turns scattered listings into one explainable search, so you can compare the
              facts that matter before taking action.
            </p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href={VERA_DEMO_URL}>
                Explore demo
              </a>
              <a className={styles.outlineAction} href={VERA_BETA_URL}>
                Join private beta
              </a>
            </div>
          </div>
        </div>

        <AtlasHero />

        <figure className={styles.heroProof} data-testid="hero-proof-card">
          <div className={styles.heroProofImage}>
            <Image
              src="/landing/vera-product-capture.png"
              alt="Vera's sanitized listing evidence interface"
              width={1672}
              height={941}
              sizes="(max-width: 760px) calc(100vw - 32px), min(30vw, 440px)"
            />
          </div>
          <figcaption>
            <span>Product evidence</span>
            Every source retained. Every decision explained.
          </figcaption>
        </figure>
      </section>

      <section
        className={styles.section}
        id="product"
        data-marketing-section
        aria-labelledby="product-heading"
      >
        <SectionReveal className={styles.sectionInner}>
          <header className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle} id="product-heading" tabIndex={-1}>
                Many sources. One search you control.
              </h2>
            </div>
            <p className={styles.sectionBody}>
              Vera accepts housing evidence through four bounded modes. Every record enters the same
              provenance, normalization, dedupe, and deterministic scoring pipeline.
            </p>
          </header>

          <div className={styles.sourceGrid}>
            {sourceModes.map((source) => (
              <article className={styles.sourceCard} key={source.name}>
                <span>{source.index}</span>
                <h3>{source.name}</h3>
                <p>{source.detail}</p>
              </article>
            ))}
          </div>

          <ol className={styles.pipeline} aria-label="Vera evidence pipeline">
            <li>Source record</li>
            <li>Normalize</li>
            <li>Provenance</li>
            <li>Deduplicate</li>
            <li>Score</li>
            <li>Renter decision</li>
          </ol>
        </SectionReveal>
      </section>

      <section
        className={`${styles.section} ${styles.productSection}`}
        id="evidence"
        data-marketing-section
        aria-labelledby="evidence-heading"
      >
        <SectionReveal className={styles.sectionInner}>
          <header className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle} id="evidence-heading" tabIndex={-1}>
                Know why this home stands out.
              </h2>
            </div>
            <p className={styles.sectionBody}>
              Vera stitches facts without erasing their origins, then separates fit, completeness,
              uncertainty, and risk so you can decide what deserves your time.
            </p>
          </header>

          <div className={styles.productFrame}>
            <div className={styles.productCapture}>
              <Image
                src="/landing/vera-product-capture.png"
                alt="Sanitized Vera listing evidence showing fit factors and retained sources"
                width={1672}
                height={941}
                sizes="(max-width: 760px) calc(100vw - 32px), 68vw"
              />
            </div>
            <div className={styles.evidenceList}>
              {evidencePoints.map((point, index) => (
                <article key={point.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className={styles.evidenceCta}>
            <p>
              See the actual interaction model with sanitized, local-only fixtures. No marketplace,
              email, calendar, or browser action runs in the demo.
            </p>
            <a className={styles.outlineAction} href={VERA_DEMO_URL}>
              Explore demo
            </a>
          </div>
        </SectionReveal>
      </section>

      <section
        className={`${styles.section} ${styles.controlSection}`}
        id="control"
        data-marketing-section
        aria-labelledby="control-heading"
      >
        <SectionReveal className={styles.sectionInner}>
          <header className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle} id="control-heading" tabIndex={-1}>
                Fast does not mean automatic.
              </h2>
            </div>
            <p className={styles.sectionBody}>
              Vera speeds up research and preparation while keeping you in charge of every external
              effect.
            </p>
          </header>

          <div className={styles.controlGrid}>
            {controlPoints.map((point) => (
              <article className={styles.controlCard} key={point.title}>
                <span>{point.index}</span>
                <h3>{point.title}</h3>
                <p>{point.detail}</p>
              </article>
            ))}
          </div>

          <div className={styles.activityPanel}>
            <div className={styles.activityCopy}>
              <h3>Nothing important disappears into the agent.</h3>
              <p>
                Vera distinguishes a prepared draft from a sent message, a tentative hold from an
                invitation, and an observed risk signal from a definitive accusation.
              </p>
            </div>
            <Image
              src="/landing/vera-activity-capture.png"
              alt="Vera's sanitized append-only activity history"
              width={1280}
              height={720}
              sizes="(max-width: 760px) calc(100vw - 32px), 54vw"
            />
          </div>
        </SectionReveal>
      </section>

      <section
        className={`${styles.section} ${styles.moveSection}`}
        id="browser-connector"
        data-marketing-section
        aria-labelledby="browser-heading"
      >
        <SectionReveal className={`${styles.sectionInner} ${styles.moveGrid}`}>
          <div className={styles.moveVisual}>
            <Image
              src="/landing/vera-evidence-house.png"
              alt="Layered housing evidence assembling into an apartment building"
              width={1003}
              height={1568}
              sizes="(max-width: 760px) calc(100vw - 32px), 42vw"
            />
          </div>

          <div className={styles.moveCopy}>
            <p className={styles.eyebrow}>Private-beta browser connector</p>
            <h2 className={styles.sectionTitle} id="browser-heading" tabIndex={-1}>
              Share one search tab. Revoke it whenever you want.
            </h2>
            <p className={styles.sectionBody}>
              Approved testers can pair Vera&apos;s browser connector and explicitly share one
              dedicated housing-search tab for bounded, read-only research.
            </p>
            <ol className={styles.moveSteps}>
              <li>
                <span>01</span>Pair through a one-time, tester-specific credential
              </li>
              <li>
                <span>02</span>Prepare and visibly share exactly one tab
              </li>
              <li>
                <span>03</span>Unshare or unpair to stop future browser work
              </li>
            </ol>
            <p className={styles.connectorTruth}>
              Vera stops for login, CAPTCHA, consent, and changed layouts. It never clicks Contact,
              Apply, Tour, Reply, Message, payment, upload, or download controls.
            </p>
            <a className={styles.outlineAction} href="/privacy/browser-connector">
              Read connector privacy details <span aria-hidden="true">↗</span>
            </a>
            {connectorUrl ? (
              <a className={styles.primaryAction} href={connectorUrl}>
                Install browser connector — approved testers
              </a>
            ) : (
              <a className={styles.primaryAction} href={VERA_BETA_URL}>Join private beta</a>
            )}
          </div>
        </SectionReveal>
      </section>

      <section
        className={`${styles.section} ${styles.closingSection}`}
        id="beta"
        data-marketing-section
        aria-labelledby="beta-heading"
      >
        <SectionReveal className={styles.closingInner}>
          <h2 id="beta-heading" tabIndex={-1}>
            Your search. Your evidence. Your call.
          </h2>
          <p>
            Vera is opening a small, founder-supported beta for renters who want a faster search
            without giving up control.
          </p>
          <div className={styles.closingActions}>
            <a className={styles.primaryAction} href={VERA_BETA_URL}>
              Join private beta
            </a>
            <a className={styles.textAction} href={VERA_DEMO_URL}>
              Explore demo
            </a>
          </div>
        </SectionReveal>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <a className={styles.brand} href="/" aria-label="Vera home">
            <span className={styles.brandMark} aria-hidden="true">
              V
            </span>
            <span>Vera</span>
          </a>
          <p>Renter-controlled housing search.</p>
          <div>
            <a href={VERA_DEMO_URL}>Demo</a>
            <a href={VERA_BETA_URL}>Private beta</a>
            <a href="/privacy">Privacy</a>
            <a href="/support">Support</a>
            <a href="/privacy/browser-connector">Connector privacy</a>
            <a href="/support/browser-connector">Connector support</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
