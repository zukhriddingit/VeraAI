"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import type { PublicDemoListing } from "./public-demo-fixtures.ts";
import styles from "./public-demo.module.css";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface PublicDemoProps {
  readonly listings: readonly PublicDemoListing[];
  readonly profile: {
    readonly location: string;
    readonly maximumRent: number;
    readonly bedrooms: number;
    readonly moveIn: string;
    readonly mustHaves: readonly string[];
  };
}

export function PublicDemo({ listings, profile }: PublicDemoProps) {
  const [minimumFit, setMinimumFit] = useState(0);
  const [selectedId, setSelectedId] = useState(listings[0]?.id ?? "");
  const filteredListings = useMemo(
    () => listings.filter((listing) => listing.fitScore >= minimumFit),
    [listings, minimumFit]
  );
  const selected = listings.find((listing) => listing.id === selectedId) ?? listings[0];

  if (!selected) return null;

  return (
    <main className={styles.shell}>
      <aside className={styles.notice} role="status">
        Sanitized demo — no marketplace, email, calendar, or browser actions occur.
      </aside>

      <header className={styles.header}>
        <a className={styles.brand} href="https://verahousing.app" aria-label="Vera marketing home">
          <span aria-hidden="true">V</span>
          VERA
        </a>
        <nav aria-label="Demo navigation">
          <span>Public demo</span>
          <a href="/beta">Join private beta</a>
          <a href="/sign-in">Sign in</a>
        </nav>
      </header>

      <section className={styles.profile} aria-labelledby="profile-title">
        <div>
          <p className={styles.eyebrow}>SANITIZED SEARCH PROFILE</p>
          <h1 id="profile-title">
            {profile.location} · up to ${integer.format(profile.maximumRent)}
          </h1>
          <p>
            {profile.bedrooms} bedroom · {profile.moveIn} · {profile.mustHaves.join(" · ")}
          </p>
        </div>
        <div className={styles.pipeline} aria-label="Deterministic listing pipeline">
          <span>Capture</span>
          <span>Normalize</span>
          <span>Provenance</span>
          <span>Dedupe</span>
          <span>Score</span>
        </div>
      </section>

      <section className={styles.workspace}>
        <div className={styles.inbox}>
          <div className={styles.toolbar}>
            <div>
              <p className={styles.eyebrow}>NORMALIZED INBOX</p>
              <h2>Three matches</h2>
            </div>
            <label>
              Minimum fit
              <select
                value={minimumFit}
                onChange={(event) => setMinimumFit(Number(event.target.value))}
              >
                <option value={0}>All</option>
                <option value={80}>80%+</option>
              </select>
            </label>
          </div>

          <div className={styles.cards}>
            {filteredListings.map((listing) => (
              <button
                key={listing.id}
                type="button"
                className={styles.card}
                aria-pressed={listing.id === selected.id}
                onClick={() => setSelectedId(listing.id)}
              >
                <span className={styles.photo}>
                  {listing.photo.src ? (
                    <Image
                      src={listing.photo.src}
                      alt={listing.photo.alt}
                      width={320}
                      height={200}
                    />
                  ) : (
                    <span className={styles.placeholder}>{listing.photo.alt}</span>
                  )}
                  <span className={styles.fitBadge}>{listing.fitScore}% fit</span>
                </span>
                <span className={styles.cardBody}>
                  <span className={styles.badges}>{listing.sourceBadges.join(" + ")}</span>
                  <strong>{listing.address}</strong>
                  <span>{listing.rentLabel}</span>
                  <span>
                    {listing.beds} · {listing.baths} · {listing.completeness}% details
                  </span>
                  <small>{listing.freshness}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <article className={styles.detail} aria-live="polite">
          <div className={styles.detailHero}>
            {selected.photo.src ? (
              <Image
                src={selected.photo.src}
                alt={selected.photo.alt}
                width={720}
                height={400}
                priority
              />
            ) : (
              <div className={styles.placeholder}>{selected.photo.alt}</div>
            )}
            <div className={styles.detailOverlay}>
              <p>{selected.sourceBadges.join(" · ")}</p>
              <h2>{selected.address}</h2>
              <strong>{selected.rentLabel}</strong>
            </div>
          </div>

          <div className={styles.detailGrid}>
            <section>
              <p className={styles.eyebrow}>PRICE</p>
              <h3>Required fees</h3>
              <p>
                {selected.requiredFees.length
                  ? selected.requiredFees.join(" · ")
                  : "No required fee was observed."}
              </p>
            </section>
            <section>
              <p className={styles.eyebrow}>TIMING</p>
              <h3>Availability &amp; lease</h3>
              <ul>
                {selected.availability.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </section>
            <section>
              <p className={styles.eyebrow}>OBSERVED</p>
              <h3>Facts &amp; amenities</h3>
              <p>{[...selected.facts, ...selected.amenities].join(" · ")}</p>
            </section>
            <section>
              <p className={styles.eyebrow}>NEEDS VERIFICATION</p>
              <h3>Missing information</h3>
              <ul>
                {selected.missing.map((value) => (
                  <li key={value}>{value}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className={styles.fullSection}>
            <p className={styles.eyebrow}>EXPLAINABLE SCORE</p>
            <h3>Why it fits</h3>
            <div className={styles.factorList}>
              {selected.fitFactors.map((factor) => (
                <div key={factor.label}>
                  <span style={{ "--factor": `${factor.value}%` } as React.CSSProperties} />
                  <strong>
                    {factor.label} · {factor.value}%
                  </strong>
                  <p>{factor.reason}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.fullSection}>
            <p className={styles.eyebrow}>EVIDENCE, NOT A VERDICT</p>
            <h3>Risk indicators</h3>
            <ul>
              {selected.risks.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </section>

          <section className={styles.fullSection}>
            <p className={styles.eyebrow}>RETAINED ORIGINS</p>
            <h3>Sources &amp; provenance</h3>
            {selected.sources.map((source) => (
              <p key={source.url}>
                <a href={source.url} rel="noreferrer" onClick={(event) => event.preventDefault()}>
                  View sanitized source evidence
                </a>{" "}
                · {source.label} · observed {source.observedAt}
              </p>
            ))}
          </section>

          <section className={styles.fullSection}>
            <p className={styles.eyebrow}>APPEND-ONLY HISTORY</p>
            <h3>Activity</h3>
            <div className={styles.timeline}>
              {selected.activity.map((item) => (
                <p key={item.label}>
                  <strong>{item.label}</strong>
                  {item.detail}
                </p>
              ))}
            </div>
          </section>

          <p className={styles.demoOnly}>
            Demo only: shortlist, outreach, calendar, search, and refresh controls are intentionally
            unavailable.
          </p>
        </article>
      </section>
    </main>
  );
}
