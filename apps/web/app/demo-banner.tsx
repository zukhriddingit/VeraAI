"use client";

import { usePathname } from "next/navigation";

export function DemoBanner() {
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <div className="demo-banner" role="status">
      <span aria-hidden="true">●</span>
      <strong>Demo mode</strong> - sanitized fixture data; no live marketplace accounts connected.
    </div>
  );
}
