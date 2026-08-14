"use client";

import { useEffect, useState } from "react";

import { VERA_BETA_URL, VERA_SIGN_IN_URL } from "../lib/urls.ts";
import styles from "./landing-page.module.css";
import {
  MARKETING_SECTION_IDS,
  navigationBehavior,
  normalizedSectionHash,
  type MarketingSectionId
} from "./motion-policy.ts";

const links: readonly { readonly id: MarketingSectionId; readonly label: string }[] = [
  { id: "product", label: "How it works" },
  { id: "evidence", label: "Product" },
  { id: "control", label: "Safety" },
  { id: "browser-connector", label: "Browser beta" }
];

function focusAndScroll(id: MarketingSectionId) {
  const target = document.getElementById(id);
  if (!target) return;
  const heading = target.querySelector<HTMLElement>("h1, h2");
  heading?.focus({ preventScroll: true });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: navigationBehavior(reducedMotion), block: "start" });
}

export function SiteNavigation() {
  const [active, setActive] = useState<MarketingSectionId | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = visible ? normalizedSectionHash(`#${visible.target.id}`) : null;
        if (id) setActive(id);
      },
      { rootMargin: "-96px 0px -65% 0px", threshold: [0, 0.1, 0.5] }
    );

    for (const id of MARKETING_SECTION_IDS) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }

    const onPopState = () => {
      const id = normalizedSectionHash(window.location.hash);
      if (id) focusAndScroll(id);
      else window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  return (
    <nav className={styles.nav} aria-label="Public navigation">
      <a className={styles.brand} href="/" aria-label="Vera home">
        <span className={styles.brandMark} aria-hidden="true">
          V
        </span>
        <span>Vera</span>
      </a>
      <div className={styles.navLinks}>
        {links.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            aria-current={active === link.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              window.history.pushState(null, "", `#${link.id}`);
              focusAndScroll(link.id);
            }}
          >
            {link.label}
          </a>
        ))}
      </div>
      <div className={styles.navActions}>
        <a className={styles.signInAction} href={VERA_SIGN_IN_URL}>
          Sign in
        </a>
        <a className={`${styles.primaryAction} ${styles.navAction}`} href={VERA_BETA_URL}>
          Join private beta
        </a>
      </div>
    </nav>
  );
}
