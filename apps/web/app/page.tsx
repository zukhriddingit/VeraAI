import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { AtlasHero } from "./atlas-hero";
import styles from "./landing-page.module.css";

export const metadata: Metadata = {
  title: "Vera | Find fast. Rent safely.",
  description:
    "A renter-controlled AI copilot that turns scattered housing listings into one evidence-backed search."
};

const sourceModes = [
  {
    index: "01",
    name: "Official API",
    detail: "Reviewed access only"
  },
  {
    index: "02",
    name: "Email alert",
    detail: "Provider-supported intake"
  },
  {
    index: "03",
    name: "Local browser",
    detail: "Exact saved searches only"
  },
  {
    index: "04",
    name: "User capture",
    detail: "Evidence you provide"
  }
] as const;

const evidencePoints = [
  {
    title: "Source retained",
    detail: "Every original record remains inspectable."
  },
  {
    title: "Unknown visible",
    detail: "Missing facts are never guessed."
  },
  {
    title: "Risk separated",
    detail: "Evidence appears without a fake verdict."
  },
  {
    title: "Fit explained",
    detail: "Deterministic factors show why a home ranked."
  }
] as const;

const controlPoints = [
  {
    index: "01",
    title: "Fail closed by default",
    detail: "A source or action stays off until its policy explicitly permits the capability."
  },
  {
    index: "02",
    title: "Evidence before outreach",
    detail: "Vera prepares questions from known facts and keeps every unresolved field visible."
  },
  {
    index: "03",
    title: "Approval beside the action",
    detail: "Drafts and tentative holds require review of the exact payload before any write."
  },
  {
    index: "04",
    title: "Every step recorded",
    detail: "Material decisions appear in an append-only activity history."
  }
] as const;

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <nav className={styles.nav} aria-label="Public navigation">
          <Link className={styles.brand} href="/" aria-label="Vera home">
            <span className={styles.brandMark} aria-hidden="true">
              V
            </span>
            <span>Vera</span>
          </Link>
          <div className={styles.navLinks}>
            <a href="#how-it-works">How it works</a>
            <a href="#product">Product</a>
            <a href="#safety">Safety</a>
            <a href="#veramove">VeraMove</a>
          </div>
          <Link className={`${styles.primaryAction} ${styles.navAction}`} href="/demo">
            Open demo
          </Link>
        </nav>

        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Find fast. Rent safely.</p>
            <h1 className={styles.heroTitle} id="landing-title">
              Find a great home faster.
            </h1>
            <p className={styles.heroBody}>
              Vera turns scattered listings into one evidence-backed search, so renters can compare
              fit, missing facts, and risk before taking action.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/demo">
                Explore the live demo
              </Link>
              <a className={styles.textAction} href="#how-it-works">
                See how Vera works
                <span aria-hidden="true"> ↘</span>
              </a>
            </div>
            <p className={styles.truthLabel}>
              Sanitized data. Deterministic decisions. No autonomous outreach.
            </p>
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

      <section className={styles.section} id="how-it-works" aria-labelledby="sources-heading">
        <div className={styles.sectionInner}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>From signal to shortlist</p>
              <h2 className={styles.sectionTitle} id="sources-heading">
                Many sources. One search you control.
              </h2>
            </div>
            <p className={styles.sectionBody}>
              Vera accepts evidence through four bounded acquisition modes. Each source must pass a
              fail-closed policy before its records enter the same deterministic decision path.
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
            <li>Rank</li>
            <li>Renter approval</li>
          </ol>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.productSection}`}
        id="product"
        aria-labelledby="product-heading"
      >
        <div className={styles.sectionInner}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Canonical listing evidence</p>
              <h2 className={styles.sectionTitle} id="product-heading">
                Know why this home stands out.
              </h2>
            </div>
            <p className={styles.sectionBody}>
              Vera stitches facts without erasing their origins, then separates fit, uncertainty,
              and risk so you can decide what deserves your time.
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

          <p className={styles.demoMetric}>
            <strong>12 source records</strong>
            become
            <strong>8 canonical homes</strong>
            in the sanitized deterministic demo.
          </p>
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.controlSection}`}
        id="safety"
        aria-labelledby="control-heading"
      >
        <div className={styles.sectionInner}>
          <header className={styles.sectionHeader}>
            <div>
              <p className={styles.eyebrow}>Renter-controlled by design</p>
              <h2 className={styles.sectionTitle} id="control-heading">
                Fast does not mean automatic.
              </h2>
            </div>
            <p className={styles.sectionBody}>
              Vera speeds up research and preparation while keeping the renter in charge of every
              external effect.
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
              <p className={styles.eyebrow}>Visible control</p>
              <h3>Nothing important disappears into the agent.</h3>
              <p>
                The deterministic demo creates no marketplace message, Gmail draft, or real Calendar
                event. It shows the evidence and records the renter&apos;s decisions.
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
        </div>
      </section>

      <section
        className={`${styles.section} ${styles.moveSection}`}
        id="veramove"
        aria-labelledby="move-heading"
      >
        <div className={`${styles.sectionInner} ${styles.moveGrid}`}>
          <div className={styles.moveVisual}>
            <Image
              src="/landing/vera-evidence-house.png"
              alt="Layered move evidence assembling into an apartment building"
              width={1003}
              height={1568}
              sizes="(max-width: 760px) calc(100vw - 32px), 42vw"
            />
            <span>Additional feature in development</span>
          </div>

          <div className={styles.moveCopy}>
            <p className={styles.eyebrow}>VeraMove</p>
            <h2 className={styles.sectionTitle} id="move-heading">
              From the right home to the right move.
            </h2>
            <p className={styles.sectionBody}>
              VeraMove extends the journey after a renter chooses a home. The prototype turns one
              versioned move plan into three synthetic vendor comparisons with evidence-backed
              ranking.
            </p>
            <ol className={styles.moveSteps}>
              <li>
                <span>01</span>
                Lock one reviewable move plan
              </li>
              <li>
                <span>02</span>
                Compare three synthetic vendor results
              </li>
              <li>
                <span>03</span>
                Explain the ranking before any booking
              </li>
            </ol>
            <a
              className={styles.outlineAction}
              href="https://github.com/zukhriddingit/VeraMove"
              target="_blank"
              rel="noreferrer"
            >
              View the VeraMove prototype
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.closingSection}`}>
        <div className={styles.closingInner}>
          <p className={styles.eyebrow}>Find fast. Rent safely.</p>
          <h2>Your housing search should move at your speed.</h2>
          <p>
            See how Vera turns a bounded set of sanitized source records into inspectable,
            explainable housing decisions.
          </p>
          <Link className={styles.primaryAction} href="/demo">
            Explore the live demo
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <Link className={styles.brand} href="/" aria-label="Vera home">
            <span className={styles.brandMark} aria-hidden="true">
              V
            </span>
            <span>Vera</span>
          </Link>
          <p>Renter-controlled housing search.</p>
          <div>
            <a href="#product">Product</a>
            <a href="#safety">Safety</a>
            <a href="https://github.com/zukhriddingit/VeraMove">VeraMove</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
