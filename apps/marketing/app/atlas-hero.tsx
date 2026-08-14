"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

import styles from "./landing-page.module.css";

type HeroStyle = CSSProperties & {
  "--pointer-x": string;
  "--pointer-y": string;
};

export function AtlasHero() {
  const root = useRef<HTMLDivElement>(null);
  const [intersecting, setIntersecting] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const motionActive = intersecting && documentVisible && motionAllowed;

  useEffect(() => {
    const element = root.current;
    if (!element) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(pointer: fine)");
    const updateMedia = () => {
      setMotionAllowed(!reduceMotion.matches);
      setFinePointer(pointer.matches);
    };
    const updateVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    const observer = new IntersectionObserver(
      ([entry]) => setIntersecting(Boolean(entry?.isIntersecting)),
      { threshold: 0.08 }
    );

    updateMedia();
    updateVisibility();
    observer.observe(element);
    reduceMotion.addEventListener("change", updateMedia);
    pointer.addEventListener("change", updateMedia);
    document.addEventListener("visibilitychange", updateVisibility);

    return () => {
      observer.disconnect();
      reduceMotion.removeEventListener("change", updateMedia);
      pointer.removeEventListener("change", updateMedia);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  function updatePointer(event: PointerEvent<HTMLDivElement>) {
    if (!motionActive || !finePointer || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2));
    event.currentTarget.style.setProperty("--pointer-x", x.toFixed(3));
    event.currentTarget.style.setProperty("--pointer-y", y.toFixed(3));
  }

  function resetPointer(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--pointer-x", "0");
    event.currentTarget.style.setProperty("--pointer-y", "0");
  }

  const initialStyle: HeroStyle = { "--pointer-x": "0", "--pointer-y": "0" };

  return (
    <div
      ref={root}
      className={styles.atlasStage}
      data-atlas-motion
      data-motion-active={motionActive ? "true" : "false"}
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
