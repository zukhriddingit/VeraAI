# Marketing and Public Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Vera's atlas/coral marketing site from the reviewed historical source, make every launch link canonical, and add a useful public demo that is statically isolated from production data and side effects.

**Architecture:** Add a separate `@vera/marketing` Next.js application for Vercel while keeping the Heroku product in `@vera/web`. Implement `/demo` inside the product application as a fixture-only client island that imports no server repositories and calls no API. Verify both boundaries with source scanners, unit tests, and a two-server Playwright launch suite.

**Tech Stack:** Node.js 24, pnpm 11.14.0, TypeScript 6.0.3, Next.js 16.2.10, React 19.2.7, CSS Modules, Vitest 4.1.10, Playwright 1.61.1, Vercel, Heroku.

## Global Constraints

- Work only in `/private/tmp/vera-m13b-pr75-live-20260811` on branch `codex/private-beta-launch-polish`.
- Preserve the existing dark navy atlas composition, coral action color, Vera mark, typography, sanitized captures, and evidence-first copy; this is launch polish, not a redesign.
- `https://verahousing.app` is marketing; `https://app.verahousing.app` is the product.
- **Explore demo** links exactly to `https://app.verahousing.app/demo`.
- **Join private beta** links exactly to `https://app.verahousing.app/beta`.
- **Sign in** links exactly to `https://app.verahousing.app/sign-in`.
- No source, rendered page, metadata, or deployment configuration may contain `vera-production-f19c.up.railway.app`.
- `/demo` uses bundled sanitized fixtures and performs no authentication, database query, connector call, LLM call, worker dispatch, browser action, mutation request, or Vera cookie write.
- Source links in demo fixtures use inert `https://example.invalid/` destinations and never live marketplace or landlord records.
- Motion uses transform and opacity only; no scroll hijacking or animation dependency is added.
- `prefers-reduced-motion: reduce` makes anchors immediate, disables pointer response and auto-running motion, and leaves all content visible.
- Vercel builds only `apps/marketing`; Heroku continues to build `apps/web` and the worker without a Gateway rebuild.
- Run focused checks while iterating and one full CI run only on the final combined PR.

## File Map

- Create `apps/web/app/demo/public-demo-fixtures.ts`: versioned, sanitized presentation records and inert source links.
- Create `apps/web/app/demo/public-demo-fixtures.unit.test.ts`: fixture completeness, sanitization, and inert-link tests.
- Create `apps/web/app/demo/public-demo.tsx`: local-only filtering and detail selection.
- Create `apps/web/app/demo/public-demo.module.css`: product-shaped, responsive demo presentation.
- Create `apps/web/app/demo/page.tsx`: public server page with no session or application registry import.
- Create `apps/marketing/*`: isolated Next.js marketing workspace.
- Create `apps/marketing/lib/urls.ts`: canonical launch URL constants.
- Create `apps/marketing/app/site-navigation.tsx`: focus-aware smooth anchors and active-section tracking.
- Create `apps/marketing/app/section-reveal.tsx`: reveal-once intersection behavior.
- Create `apps/marketing/app/atlas-hero.tsx`: visibility-aware atlas motion.
- Create `apps/marketing/app/privacy/page.tsx`: general product and beta-intake privacy notice.
- Create `apps/marketing/app/motion-policy.ts`: pure reduced-motion and focus helpers.
- Restore sanitized historical assets into `apps/marketing/public/landing/`.
- Create `scripts/verify-launch-surfaces.ts`: fail-closed link and import-boundary verifier.
- Create `scripts/verify-launch-surfaces.unit.test.ts`: mutation tests for forbidden URLs and demo imports.
- Create `playwright.launch.config.ts`: starts marketing and web concurrently for public acceptance.
- Create `tests/launch/marketing.spec.ts` and `tests/launch/public-demo.spec.ts`: browser acceptance.
- Create `docs/MARKETING_RELEASE.md`: exact Vercel root, domains, smoke, and rollback procedure.
- Modify `package.json` and `.github/workflows/ci.yml`: expose and run launch verification.

---

### Task 1: Build the fixture-only public demo boundary

**Files:**
- Create: `apps/web/app/demo/public-demo-fixtures.ts`
- Create: `apps/web/app/demo/public-demo-fixtures.unit.test.ts`
- Create: `apps/web/app/demo/page.tsx`

**Interfaces:**
- Consumes: React server rendering only; no `@vera/db`, application registry, session, connector, or API module.
- Produces: `PUBLIC_DEMO_FIXTURE_VERSION`, `PUBLIC_DEMO_PROFILE`, `PUBLIC_DEMO_LISTINGS`, and `PublicDemoListing`.

- [ ] **Step 1: Write the failing fixture tests**

```ts
import { describe, expect, it } from "vitest";

import {
  PUBLIC_DEMO_FIXTURE_VERSION,
  PUBLIC_DEMO_LISTINGS
} from "./public-demo-fixtures.ts";

describe("public demo fixtures", () => {
  it("are versioned, useful, and sanitized", () => {
    expect(PUBLIC_DEMO_FIXTURE_VERSION).toBe("public-demo.v1");
    expect(PUBLIC_DEMO_LISTINGS).toHaveLength(3);
    expect(PUBLIC_DEMO_LISTINGS.some((listing) => listing.sourceBadges.length > 1)).toBe(true);
    expect(PUBLIC_DEMO_LISTINGS.every((listing) => listing.fitFactors.length >= 3)).toBe(true);
    expect(PUBLIC_DEMO_LISTINGS.every((listing) => listing.activity.length >= 2)).toBe(true);
  });

  it("contains only inert original-listing destinations", () => {
    for (const listing of PUBLIC_DEMO_LISTINGS) {
      for (const source of listing.sources) {
        expect(new URL(source.url).hostname).toBe("example.invalid");
      }
    }
  });

  it("contains no retained live-acceptance identifiers", () => {
    const serialized = JSON.stringify(PUBLIC_DEMO_LISTINGS);
    expect(serialized).not.toMatch(/221 Kelton|42027fd5|zillow\.com|facebook\.com|apartments\.com/i);
  });
});
```

- [ ] **Step 2: Run the test and verify the fixture module is absent**

Run: `pnpm exec vitest run --project unit apps/web/app/demo/public-demo-fixtures.unit.test.ts`

Expected: FAIL because `public-demo-fixtures.ts` does not exist.

- [ ] **Step 3: Create the exact presentation contract and three sanitized records**

```ts
export const PUBLIC_DEMO_FIXTURE_VERSION = "public-demo.v1" as const;

export interface PublicDemoListing {
  readonly id: string;
  readonly address: string;
  readonly rentLabel: string;
  readonly requiredFees: readonly string[];
  readonly beds: string;
  readonly baths: string;
  readonly freshness: string;
  readonly fitScore: number;
  readonly completeness: number;
  readonly sourceBadges: readonly string[];
  readonly photo: { readonly src: string | null; readonly alt: string };
  readonly availability: readonly string[];
  readonly facts: readonly string[];
  readonly amenities: readonly string[];
  readonly missing: readonly string[];
  readonly risks: readonly string[];
  readonly fitFactors: readonly { readonly label: string; readonly value: number; readonly reason: string }[];
  readonly sources: readonly { readonly label: string; readonly url: string; readonly observedAt: string }[];
  readonly activity: readonly { readonly label: string; readonly detail: string }[];
}

export const PUBLIC_DEMO_PROFILE = Object.freeze({
  location: "Boston, MA",
  maximumRent: 2800,
  bedrooms: 1,
  moveIn: "September 2026",
  mustHaves: ["Pet friendly", "Laundry"]
});

export const PUBLIC_DEMO_LISTINGS: readonly PublicDemoListing[] = Object.freeze([
  {
    id: "demo-beacon-street",
    address: "Beacon Street · Boston, MA",
    rentLabel: "$2,550 / month",
    requiredFees: ["Required building fee: $35 / month"],
    beds: "1 bed",
    baths: "1 bath",
    freshness: "Observed 18 minutes ago",
    fitScore: 88,
    completeness: 84,
    sourceBadges: ["Official API", "Housing alert"],
    photo: { src: "/demo/beacon-home.svg", alt: "Sanitized illustration of a Boston apartment" },
    availability: ["Available September 1", "12-month lease observed"],
    facts: ["640 sq ft", "Apartment", "Laundry in building"],
    amenities: ["Cats allowed", "Heat included", "Bike storage"],
    missing: ["Application fee", "Parking cost"],
    risks: ["Broker fee needs verification"],
    fitFactors: [
      { label: "Budget", value: 100, reason: "$215 below the profile's monthly limit including known fees." },
      { label: "Move-in", value: 100, reason: "Observed availability matches the requested month." },
      { label: "Must-haves", value: 67, reason: "Laundry and pet policy are observed; parking cost is unknown." }
    ],
    sources: [
      { label: "Official API record", url: "https://example.invalid/demo/beacon-api", observedAt: "2026-08-13T18:05:00.000Z" },
      { label: "Sanitized housing alert", url: "https://example.invalid/demo/beacon-alert", observedAt: "2026-08-13T18:09:00.000Z" }
    ],
    activity: [
      { label: "Discovered", detail: "Two source records entered the immutable raw-listing pipeline." },
      { label: "Clustered", detail: "Deterministic dedupe retained both source records as one canonical home." },
      { label: "Scored", detail: "Fit was computed from the explicit demo profile; no model decided eligibility." }
    ]
  },
  {
    id: "demo-somerville",
    address: "Somerville Avenue · Somerville, MA",
    rentLabel: "$2,700 / month",
    requiredFees: [],
    beds: "1 bed",
    baths: "1 bath",
    freshness: "Observed 2 hours ago",
    fitScore: 81,
    completeness: 72,
    sourceBadges: ["Browser source"],
    photo: { src: "/demo/somerville-home.svg", alt: "Sanitized illustration of a Somerville rental" },
    availability: ["Available date not observed", "Lease duration not observed"],
    facts: ["Apartment", "Laundry in unit"],
    amenities: ["Dogs allowed", "Dishwasher"],
    missing: ["Available date", "Lease duration", "Utilities", "Application fee"],
    risks: ["Total monthly cost is incomplete"],
    fitFactors: [
      { label: "Budget", value: 100, reason: "Observed base rent is within the profile limit." },
      { label: "Move-in", value: 40, reason: "The source did not publish an available date." },
      { label: "Must-haves", value: 100, reason: "Pet policy and laundry were both observed." }
    ],
    sources: [{ label: "Sanitized browser record", url: "https://example.invalid/demo/somerville", observedAt: "2026-08-13T16:18:00.000Z" }],
    activity: [
      { label: "Discovered", detail: "A user-triggered, read-only source observation produced one raw record." },
      { label: "Needs verification", detail: "Availability and total recurring fees remain unknown." }
    ]
  },
  {
    id: "demo-allston",
    address: "Commonwealth Avenue · Allston, MA",
    rentLabel: "$2,375–$2,525 / month",
    requiredFees: ["Pet rent: $40 / month when applicable"],
    beds: "1 bed",
    baths: "1 bath",
    freshness: "Observed yesterday",
    fitScore: 76,
    completeness: 63,
    sourceBadges: ["User capture"],
    photo: { src: null, alt: "Source image unavailable" },
    availability: ["Available now", "Lease duration not observed"],
    facts: ["Apartment", "Square footage not observed"],
    amenities: ["Laundry in building"],
    missing: ["Deposit", "Application fee", "Utilities", "Property manager"],
    risks: ["Rent is a range", "Source image cannot be safely displayed"],
    fitFactors: [
      { label: "Budget", value: 82, reason: "The top of the observed range remains under budget before unknown fees." },
      { label: "Move-in", value: 75, reason: "The source says available now, but no lease start was observed." },
      { label: "Must-haves", value: 50, reason: "Laundry is observed; pet policy is incomplete." }
    ],
    sources: [{ label: "Sanitized user capture", url: "https://example.invalid/demo/allston", observedAt: "2026-08-12T20:04:00.000Z" }],
    activity: [
      { label: "Captured", detail: "The renter supplied listing text directly; the URL remained inert." },
      { label: "Normalized", detail: "Unknown values stayed unknown and every observed field retained provenance." }
    ]
  }
]);
```

Create `page.tsx` with only fixture and client imports:

```tsx
import { PublicDemo } from "./public-demo.tsx";
import { PUBLIC_DEMO_LISTINGS, PUBLIC_DEMO_PROFILE } from "./public-demo-fixtures.ts";

export const dynamic = "force-static";

export default function DemoPage() {
  return <PublicDemo listings={PUBLIC_DEMO_LISTINGS} profile={PUBLIC_DEMO_PROFILE} />;
}
```

- [ ] **Step 4: Run the fixture test**

Run: `pnpm exec vitest run --project unit apps/web/app/demo/public-demo-fixtures.unit.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit the fixture boundary**

```sh
git add apps/web/app/demo/public-demo-fixtures.ts apps/web/app/demo/public-demo-fixtures.unit.test.ts apps/web/app/demo/page.tsx
git commit -m "feat: add sanitized public demo fixtures"
```

---

### Task 2: Render local-only demo interactions

**Files:**
- Create: `apps/web/app/demo/public-demo.tsx`
- Create: `apps/web/app/demo/public-demo.module.css`
- Create: `apps/web/public/demo/beacon-home.svg`
- Create: `apps/web/public/demo/somerville-home.svg`

**Interfaces:**
- Consumes: `PublicDemoListing[]` and `PUBLIC_DEMO_PROFILE` from Task 1.
- Produces: `PublicDemo(props)` with client-local filters, selection, evidence panels, and no network API.

- [ ] **Step 1: Add a failing source-boundary assertion to the fixture test**

```ts
import { readFile } from "node:fs/promises";

it("keeps the client component free of network and authenticated application imports", async () => {
  const source = await readFile(new URL("./public-demo.tsx", import.meta.url), "utf8");
  expect(source).not.toMatch(/fetch\s*\(|@vera\/db|application-registry|requireVeraSession|\/api\//);
});
```

- [ ] **Step 2: Run the test and confirm the client component is absent**

Run: `pnpm exec vitest run --project unit apps/web/app/demo/public-demo-fixtures.unit.test.ts`

Expected: FAIL with `ENOENT` for `public-demo.tsx`.

- [ ] **Step 3: Implement the client-only walkthrough**

Use this state boundary in `public-demo.tsx`; render cards from `filteredListings`, the selected listing's nine evidence sections, and inert source anchors without adding submit forms:

```tsx
"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { PublicDemoListing } from "./public-demo-fixtures.ts";
import styles from "./public-demo.module.css";

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
        <a href="https://verahousing.app" aria-label="Vera marketing home">VERA</a>
        <div><span>Public demo</span><a href="/beta">Join private beta</a><a href="/sign-in">Sign in</a></div>
      </header>
      <section className={styles.profile} aria-labelledby="profile-title">
        <p>SEARCH PROFILE</p><h1 id="profile-title">{profile.location} · up to ${profile.maximumRent.toLocaleString()}</h1>
        <p>{profile.bedrooms} bedroom · {profile.moveIn} · {profile.mustHaves.join(" · ")}</p>
      </section>
      <section className={styles.workspace}>
        <div className={styles.inbox}>
          <div className={styles.toolbar}>
            <h2>Three normalized matches</h2>
            <label>Minimum fit
              <select value={minimumFit} onChange={(event) => setMinimumFit(Number(event.target.value))}>
                <option value={0}>All</option><option value={80}>80%+</option>
              </select>
            </label>
          </div>
          <div className={styles.cards}>
            {filteredListings.map((listing) => (
              <button key={listing.id} type="button" className={styles.card} aria-pressed={listing.id === selected.id} onClick={() => setSelectedId(listing.id)}>
                <span className={styles.photo}>{listing.photo.src ? <Image src={listing.photo.src} alt={listing.photo.alt} width={320} height={200} /> : <span>{listing.photo.alt}</span>}</span>
                <span className={styles.cardBody}><span className={styles.badges}>{listing.sourceBadges.join(" + ")}</span><strong>{listing.address}</strong><span>{listing.rentLabel} · {listing.beds} · {listing.baths}</span><span>{listing.fitScore}% fit · {listing.completeness}% details</span><small>{listing.freshness}</small></span>
              </button>
            ))}
          </div>
        </div>
        <article className={styles.detail} aria-live="polite">
          <div className={styles.detailHero}>{selected.photo.src ? <Image src={selected.photo.src} alt={selected.photo.alt} width={640} height={360} priority /> : <div>{selected.photo.alt}</div>}<div><p>{selected.sourceBadges.join(" · ")}</p><h2>{selected.address}</h2><strong>{selected.rentLabel}</strong></div></div>
          <section><h3>Price and required fees</h3><p>{selected.requiredFees.length ? selected.requiredFees.join(" · ") : "No required fee was observed."}</p></section>
          <section><h3>Availability and lease</h3><ul>{selected.availability.map((value) => <li key={value}>{value}</li>)}</ul></section>
          <section><h3>Property facts and amenities</h3><p>{[...selected.facts, ...selected.amenities].join(" · ")}</p></section>
          <section><h3>Why it fits</h3>{selected.fitFactors.map((factor) => <p key={factor.label}><strong>{factor.label}: {factor.value}%</strong> {factor.reason}</p>)}</section>
          <section><h3>Missing information</h3><ul>{selected.missing.map((value) => <li key={value}>{value}</li>)}</ul></section>
          <section><h3>Risk indicators</h3><ul>{selected.risks.map((value) => <li key={value}>{value}</li>)}</ul></section>
          <section><h3>Sources and provenance</h3>{selected.sources.map((source) => <p key={source.url}><a href={source.url} rel="noreferrer">View sanitized source evidence</a> · observed {source.observedAt}</p>)}</section>
          <section><h3>Activity history</h3>{selected.activity.map((item) => <p key={item.label}><strong>{item.label}</strong> — {item.detail}</p>)}</section>
          <p className={styles.demoOnly}>Demo only: shortlist, outreach, calendar, search, and refresh controls are intentionally unavailable.</p>
        </article>
      </section>
    </main>
  );
}
```

Use CSS variables already defined in `apps/web/app/globals.css`, add a two-column desktop workspace, a one-column layout below `900px`, visible `:focus-visible` rings, and `object-fit: cover` only for local SVG images. Create the two SVGs with abstract building silhouettes and the text-free `role="img"`/`aria-labelledby` pattern; do not embed a marketplace screenshot.

- [ ] **Step 4: Verify source isolation and production build**

Run: `pnpm exec vitest run --project unit apps/web/app/demo/public-demo-fixtures.unit.test.ts && pnpm --filter @vera/web run build`

Expected: fixture tests PASS and Next build lists `○ /demo` without requiring authentication.

- [ ] **Step 5: Commit the demo UI**

```sh
git add apps/web/app/demo apps/web/public/demo
git commit -m "feat: render public product demo"
```

---

### Task 3: Create the canonical marketing workspace

**Files:**
- Create: `apps/marketing/package.json`
- Create: `apps/marketing/tsconfig.json`
- Create: `apps/marketing/next-env.d.ts`
- Create: `apps/marketing/next.config.ts`
- Create: `apps/marketing/app/layout.tsx`
- Create: `apps/marketing/app/globals.css`
- Create: `apps/marketing/app/page.tsx`
- Create: `apps/marketing/app/privacy/page.tsx`
- Create: `apps/marketing/app/landing-page.module.css`
- Create: `apps/marketing/lib/urls.ts`
- Create: `apps/marketing/public/landing/vera-activity-capture.png`
- Create: `apps/marketing/public/landing/vera-atlas-hero.png`
- Create: `apps/marketing/public/landing/vera-evidence-house.png`
- Create: `apps/marketing/public/landing/vera-product-capture.png`

**Interfaces:**
- Consumes: reviewed visual source and binary assets from commit `d578f76d92e6390f002072ee1a8924e4c2d50d11` only.
- Produces: `@vera/marketing`, `VERA_DEMO_URL`, `VERA_BETA_URL`, and `VERA_SIGN_IN_URL`.

- [ ] **Step 1: Write a failing canonical-link test**

Create `apps/marketing/lib/urls.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VERA_BETA_URL, VERA_DEMO_URL, VERA_SIGN_IN_URL } from "./urls.ts";

describe("marketing launch links", () => {
  it("targets the canonical Heroku product domain", () => {
    expect(VERA_DEMO_URL).toBe("https://app.verahousing.app/demo");
    expect(VERA_BETA_URL).toBe("https://app.verahousing.app/beta");
    expect(VERA_SIGN_IN_URL).toBe("https://app.verahousing.app/sign-in");
  });
});
```

- [ ] **Step 2: Run the test and verify the marketing workspace is absent**

Run: `pnpm exec vitest run --project unit apps/marketing/lib/urls.unit.test.ts`

Expected: FAIL because `apps/marketing/lib/urls.ts` does not exist.

- [ ] **Step 3: Add workspace configuration, constants, and reviewed assets**

Create `apps/marketing/package.json`:

```json
{
  "name": "@vera/marketing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --hostname 127.0.0.1 --port 3001",
    "build": "next build",
    "start": "next start --hostname 127.0.0.1 --port 3001",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "16.2.10",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  }
}
```

Create `apps/marketing/lib/urls.ts`:

```ts
export const VERA_PRODUCT_ORIGIN = "https://app.verahousing.app" as const;
export const VERA_DEMO_URL = `${VERA_PRODUCT_ORIGIN}/demo` as const;
export const VERA_BETA_URL = `${VERA_PRODUCT_ORIGIN}/beta` as const;
export const VERA_SIGN_IN_URL = `${VERA_PRODUCT_ORIGIN}/sign-in` as const;
```

Restore the four PNG files byte-for-byte from the historical commit into `apps/marketing/public/landing/`. Port the historical `page.tsx`, atlas component, layout, and CSS into `apps/marketing`, but replace every CTA with the constants above. Keep the existing hero and section composition; revise the browser text to “Private-beta browser connector” and “Vera stops for login, CAPTCHA, consent, and changed layouts.”

Create `/privacy` with the operator/contact identity, beta-email purpose and consent, product data categories, source/listing provenance, Google integration data, a link to `/privacy/browser-connector`, essential infrastructure providers, retention, no sale/advertising/creditworthiness use, and access/export/correction/deletion instructions using `support@verahousing.app`. Link it from the marketing footer. It must not claim self-service export/deletion is live until the private-beta plan implements and rehearses it.

Use this exact metadata in `layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://verahousing.app"),
  title: "Vera — Find fast. Rent safely.",
  description: "A renter-controlled copilot that turns fragmented housing listings into explainable, reviewable decisions."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
```

- [ ] **Step 4: Verify both workspace and URL tests**

Run: `pnpm install --lockfile-only && pnpm exec vitest run --project unit apps/marketing/lib/urls.unit.test.ts && pnpm --filter @vera/marketing run build`

Expected: lockfile updates, 1 test PASS, and Next build emits the static marketing root.

- [ ] **Step 5: Commit the canonical application**

```sh
git add apps/marketing pnpm-lock.yaml
git commit -m "feat: add canonical Vera marketing app"
```

---

### Task 4: Add accessible motion and navigation behavior

**Files:**
- Create: `apps/marketing/app/motion-policy.ts`
- Create: `apps/marketing/app/motion-policy.unit.test.ts`
- Create: `apps/marketing/app/site-navigation.tsx`
- Create: `apps/marketing/app/section-reveal.tsx`
- Create: `apps/marketing/app/atlas-hero.tsx`
- Modify: `apps/marketing/app/page.tsx`
- Modify: `apps/marketing/app/globals.css`
- Modify: `apps/marketing/app/landing-page.module.css`

**Interfaces:**
- Consumes: section IDs `product`, `evidence`, `control`, `browser-connector`, and `beta`.
- Produces: `navigationBehavior(reducedMotion): ScrollBehavior`, `focusSection(id)`, `SiteNavigation`, `SectionReveal`, and `AtlasHero`.

- [ ] **Step 1: Write failing motion-policy tests**

```ts
import { describe, expect, it } from "vitest";
import { navigationBehavior, normalizedSectionHash } from "./motion-policy.ts";

describe("marketing motion policy", () => {
  it("uses smooth movement only when motion is allowed", () => {
    expect(navigationBehavior(false)).toBe("smooth");
    expect(navigationBehavior(true)).toBe("auto");
  });

  it("accepts only known section hashes", () => {
    expect(normalizedSectionHash("#evidence")).toBe("evidence");
    expect(normalizedSectionHash("#unknown")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify policy exports are absent**

Run: `pnpm exec vitest run --project unit apps/marketing/app/motion-policy.unit.test.ts`

Expected: FAIL because `motion-policy.ts` does not exist.

- [ ] **Step 3: Implement pure policy and browser components**

```ts
export const MARKETING_SECTION_IDS = ["product", "evidence", "control", "browser-connector", "beta"] as const;
export type MarketingSectionId = (typeof MARKETING_SECTION_IDS)[number];

export function navigationBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

export function normalizedSectionHash(hash: string): MarketingSectionId | null {
  const candidate = hash.replace(/^#/, "");
  return MARKETING_SECTION_IDS.find((id) => id === candidate) ?? null;
}
```

In `SiteNavigation`, intercept only same-page section links, call `history.pushState`, focus the target heading with `preventScroll: true`, then call `scrollIntoView({ behavior: navigationBehavior(media.matches), block: "start" })`. Observe the five sections with `rootMargin: "-96px 0px -65% 0px"` and set `aria-current="location"` on the active link. Listen to `popstate` so Back restores both focus and scroll position.

In `SectionReveal`, initialize visibility to `matchMedia("(prefers-reduced-motion: reduce)").matches`, observe once at threshold `0.12`, set `data-visible="true"`, and disconnect. In `AtlasHero`, set `data-motion-active="true"` only when the hero intersects, `document.visibilityState === "visible"`, reduced motion is false, and `(pointer: fine)` matches. Use pointer coordinates only to update CSS custom properties clamped to `-1..1`; do not update layout properties.

Add these global rules:

```css
html { scroll-behavior: smooth; }
[data-marketing-section] { scroll-margin-top: 6.5rem; }
[data-reveal] { opacity: 0; transform: translateY(1rem); transition: opacity 420ms ease, transform 420ms ease; }
[data-reveal][data-visible="true"] { opacity: 1; transform: translateY(0); }
:focus-visible { outline: 3px solid #ff735f; outline-offset: 4px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  [data-reveal] { opacity: 1; transform: none; transition: none; }
  [data-atlas-motion] * { animation: none !important; transform: none !important; }
}
```

- [ ] **Step 4: Run unit, type, and build checks**

Run: `pnpm exec vitest run --project unit apps/marketing/app/motion-policy.unit.test.ts && pnpm --filter @vera/marketing run typecheck && pnpm --filter @vera/marketing run build`

Expected: 2 tests PASS, TypeScript exits 0, and marketing build exits 0.

- [ ] **Step 5: Commit the motion behavior**

```sh
git add apps/marketing/app
git commit -m "feat: polish Vera launch navigation and motion"
```

---

### Task 5: Add fail-closed launch verification and browser acceptance

**Files:**
- Create: `scripts/verify-launch-surfaces.ts`
- Create: `scripts/verify-launch-surfaces.unit.test.ts`
- Create: `playwright.launch.config.ts`
- Create: `tests/launch/marketing.spec.ts`
- Create: `tests/launch/public-demo.spec.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: marketing source, public-demo source, both built applications.
- Produces: `findLaunchSurfaceViolations(input): string[]`, `pnpm verify:launch-surfaces`, and `pnpm test:e2e:launch`.

- [ ] **Step 1: Write failing verifier mutation tests**

```ts
import { describe, expect, it } from "vitest";
import { findLaunchSurfaceViolations } from "./verify-launch-surfaces.ts";

const clean = {
  marketing: `href={VERA_DEMO_URL} href={VERA_BETA_URL} href={VERA_SIGN_IN_URL}`,
  demoPage: `import { PublicDemo } from "./public-demo.tsx";`,
  demoClient: `"use client"; useState();`,
  allLaunchText: "https://app.verahousing.app/demo"
};

describe("launch surface boundary", () => {
  it("accepts the static split", () => expect(findLaunchSurfaceViolations(clean)).toEqual([]));
  it("rejects Railway", () => expect(findLaunchSurfaceViolations({ ...clean, allLaunchText: "https://vera-production-f19c.up.railway.app/" })).toContain("Obsolete Railway URL is forbidden."));
  it("rejects repository imports in the demo", () => expect(findLaunchSurfaceViolations({ ...clean, demoPage: `import { x } from "@vera/db"` })).toContain("Public demo must not import application or persistence code."));
  it("rejects API requests in the demo client", () => expect(findLaunchSurfaceViolations({ ...clean, demoClient: `fetch("/api/listings")` })).toContain("Public demo must not call an API."));
});
```

- [ ] **Step 2: Run the verifier test and confirm its module is absent**

Run: `pnpm exec vitest run --project unit scripts/verify-launch-surfaces.unit.test.ts`

Expected: FAIL because `verify-launch-surfaces.ts` does not exist.

- [ ] **Step 3: Implement scanner and Playwright configuration**

Implement `findLaunchSurfaceViolations` using literal regular expressions for the old Railway hostname, live marketplace domains inside demo fixtures, server-side imports in `apps/web/app/demo`, `/api/` and `fetch(` in `public-demo.tsx`, missing canonical URL constants, and missing `force-static`. The executable reads all tracked text files below `apps/marketing`, `apps/web/app/demo`, `docs/MARKETING_RELEASE.md`, and the Vercel configuration; it prints one violation per line and sets exit code 1.

Add scripts:

```json
{
  "verify:launch-surfaces": "tsx scripts/verify-launch-surfaces.ts",
  "test:e2e:launch": "playwright test --config playwright.launch.config.ts"
}
```

Configure Playwright with two web servers: `pnpm --filter @vera/marketing run dev` at `http://127.0.0.1:3001` and `pnpm --filter @vera/web exec next dev --hostname 127.0.0.1 --port 3002` at `http://127.0.0.1:3002`. Give the projects separate `baseURL` values.

`marketing.spec.ts` must assert all three absolute CTA destinations, keyboard focus after clicking `#evidence`, mobile navigation at 390x844, active `aria-current`, and reduced-motion computed styles. `public-demo.spec.ts` must attach a request listener, interact with the fit filter and second card, assert no URL whose pathname starts with `/api/`, assert every evidence destination has hostname `example.invalid`, and assert `document.cookie` has no `vera` prefix.

- [ ] **Step 4: Run the launch gate**

Run: `pnpm verify:launch-surfaces && pnpm test:e2e:launch`

Expected: verifier exits 0 and both Playwright projects pass with zero `/api/` requests from `/demo`.

- [ ] **Step 5: Commit the launch gate**

```sh
git add scripts/verify-launch-surfaces.ts scripts/verify-launch-surfaces.unit.test.ts playwright.launch.config.ts tests/launch package.json .github/workflows/ci.yml
git commit -m "test: verify Vera public launch surfaces"
```

---

### Task 6: Document, deploy, verify, and retain rollback

**Files:**
- Create: `apps/marketing/vercel.json`
- Create: `docs/MARKETING_RELEASE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: a green final PR and canonical Vercel/Heroku projects.
- Produces: one reviewed marketing deployment, one public demo deployment, and bounded production evidence.

- [ ] **Step 1: Encode the Vercel application root**

Create `apps/marketing/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "cleanUrls": true,
  "trailingSlash": false
}
```

In `docs/MARKETING_RELEASE.md`, record these exact project settings: repository current merged commit; Root Directory `apps/marketing`; Framework Preset `Next.js`; Install Command `corepack enable && pnpm install --frozen-lockfile`; Build Command `pnpm run build`; Output Directory empty; domains `verahousing.app` and `www.verahousing.app`; permanent redirect from `www` to apex.

- [ ] **Step 2: Run all slice checks before external mutation**

Run: `pnpm verify:launch-surfaces && pnpm exec vitest run --project unit apps/web/app/demo apps/marketing scripts/verify-launch-surfaces.unit.test.ts && pnpm --filter @vera/web run build && pnpm --filter @vera/marketing run build && pnpm test:e2e:launch`

Expected: every command exits 0.

- [ ] **Step 3: Merge the green PR and deploy the two application surfaces**

Deploy the reviewed commit to the existing Heroku `web` and `worker` processes using the repository's production release runbook; verify `/api/ready` before promoting. Update the existing Vercel marketing project Root Directory to `apps/marketing`, deploy the same merged commit, and retain the previous Vercel deployment URL for rollback. Do not change DigitalOcean, Maritime, OpenClaw, extension pairing, or Gateway containers.

- [ ] **Step 4: Run bounded production smoke checks**

Run:

```sh
curl -fsS https://app.verahousing.app/api/ready
curl -fsSI https://app.verahousing.app/demo
curl -fsS https://verahousing.app | rg -n "app\.verahousing\.app/(demo|beta|sign-in)"
curl -fsSI https://www.verahousing.app
```

Expected: readiness reports ready; `/demo` returns 200; marketing contains the three canonical product paths; `www` redirects permanently to `https://verahousing.app/`; no response contains the Railway hostname.

- [ ] **Step 5: Record release evidence and rollback rule**

Append the merged commit, Heroku release ID, Vercel deployment ID, production smoke timestamp, and result codes to private release evidence. If marketing fails, promote the retained previous Vercel deployment without rolling back Heroku. If `/demo` or readiness fails, roll back the paired Heroku web/worker release; do not reverse PostgreSQL or touch Gateway data.

Commit documentation before the final PR if it was not included earlier:

```sh
git add apps/marketing/vercel.json docs/MARKETING_RELEASE.md README.md
git commit -m "docs: add Vera marketing release runbook"
```
