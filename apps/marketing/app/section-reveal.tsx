"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface SectionRevealProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

export function SectionReveal({ children, className }: SectionRevealProps) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches || !("IntersectionObserver" in window)) {
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.12 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className={className} data-reveal data-visible={visible ? "true" : "false"}>
      {children}
    </div>
  );
}
