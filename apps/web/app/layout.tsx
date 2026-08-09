import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { DemoBanner } from "./demo-banner";

export const metadata: Metadata = {
  title: "Vera",
  description: "A renter-controlled housing search copilot"
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  const demoMode = process.env.VERA_DEMO_MODE === "1";
  return (
    <html lang="en">
      {/* Recorder and password-manager extensions may add inert root attributes before hydration. */}
      <body suppressHydrationWarning>
        {demoMode ? <DemoBanner /> : null}
        {children}
      </body>
    </html>
  );
}
