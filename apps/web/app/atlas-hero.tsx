"use client";

import Image from "next/image";
import type { CSSProperties, PointerEvent } from "react";

import styles from "./landing-page.module.css";

type HeroStyle = CSSProperties & {
  "--pointer-x": string;
  "--pointer-y": string;
};

export function AtlasHero() {
  function updatePointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    event.currentTarget.style.setProperty("--pointer-x", x.toFixed(3));
    event.currentTarget.style.setProperty("--pointer-y", y.toFixed(3));
  }

  function resetPointer(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--pointer-x", "0");
    event.currentTarget.style.setProperty("--pointer-y", "0");
  }

  const initialStyle: HeroStyle = {
    "--pointer-x": "0",
    "--pointer-y": "0"
  };

  return (
    <div
      className={styles.atlasStage}
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
      style={initialStyle}
    >
      <div className={styles.globeParallax}>
        <div className={styles.globeDrift} data-testid="atlas-globe">
          <Image
            src="/landing/vera-atlas-hero.png"
            alt="Search signals converging on a home across a silver digital atlas"
            fill
            priority
            sizes="(max-width: 760px) 112vw, 78vw"
          />
        </div>
      </div>

      <div className={styles.signalField} aria-hidden="true">
        <span className={`${styles.signalRoute} ${styles.signalRouteOne}`}>
          <span className={styles.signal} data-testid="atlas-signal" />
        </span>
        <span className={`${styles.signalRoute} ${styles.signalRouteTwo}`}>
          <span className={styles.signal} data-testid="atlas-signal" />
        </span>
        <span className={`${styles.signalRoute} ${styles.signalRouteThree}`}>
          <span className={styles.signal} data-testid="atlas-signal" />
        </span>
        <span className={styles.target} data-testid="atlas-target" />
      </div>
    </div>
  );
}
