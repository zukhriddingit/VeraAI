import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://verahousing.app"),
  title: "Vera | Find fast. Rent safely.",
  description:
    "A renter-controlled copilot that turns fragmented housing listings into explainable, reviewable decisions."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
