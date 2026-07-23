# Atlas Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved atlas-to-address public landing page at `/` while preserving the deterministic Vera cockpit at `/demo`.

**Architecture:** Keep the landing page independent of session and database code. A server-rendered page owns the copy and sections, while one small client leaf owns bounded pointer parallax for the globe; CSS Modules own all other motion and responsive behavior. Existing cockpit code moves unchanged to `/demo`, and product navigation plus end-to-end tests move with it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS Modules, `next/image`, Vitest, Playwright.

## Global Constraints

- The approved design source is `docs/superpowers/specs/2026-07-23-atlas-landing-page-design.md`.
- `/` must not read a session, database, or external API.
- `/demo` must preserve the existing cockpit and deterministic demo flow.
- Landing colors are blue-black, silver-white, cool gray, and solar coral only.
- Large-desktop proof card width is capped at `min(34vw, 520px)`.
- The proof card must not overlap the route target.
- Below 760 pixels the proof card is in normal flow below the globe.
- No new client-side motion dependency.
- All nonessential motion stops under `prefers-reduced-motion: reduce`.
- VeraMove is labeled as an additional feature in development and must not imply live calls or booking.
- Gmail sending, live marketplace access, and real demo Calendar effects must not be claimed.

---

## File map

- Create `apps/web/app/demo/page.tsx`: existing authenticated/demo cockpit route.
- Replace `apps/web/app/page.tsx`: public metadata and landing composition.
- Create `apps/web/app/atlas-hero.tsx`: client-only pointer parallax and hero artwork.
- Create `apps/web/app/landing-page.module.css`: scoped landing layout, responsive rules, and motion.
- Modify `apps/web/app/demo-banner.tsx`: suppress the demo runtime banner on the public landing route.
- Modify product-page links under `apps/web/app/`: route Dashboard, Inbox, and Listings labels to `/demo`.
- Create `apps/web/public/landing/*.png`: generated editorial artwork and sanitized product captures.
- Create `tests/e2e/landing.spec.ts`: public route, composition, reduced-motion, and mobile checks.
- Modify existing product end-to-end specs: begin cockpit flows at `/demo`.
- Modify `docs/DEMO.md`: update the recording route.

### Task 1: Separate the public and cockpit routes

**Files:**
- Create: `apps/web/app/demo/page.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/app/demo-banner.tsx`
- Modify: product navigation files containing `href="/"`
- Modify: `tests/e2e/dashboard.spec.ts`
- Modify: `tests/e2e/demo.spec.ts`
- Modify: `tests/e2e/inbox.spec.ts`
- Modify: `tests/e2e/viewing-calendar-hold.spec.ts`

**Interfaces:**
- Produces: public `/` route with no server dependencies.
- Produces: cockpit `/demo` route with the existing `requireVeraPageSession()` and `loadCockpitInitialState()` behavior.
- Preserves: every existing nested product route and API route.

- [ ] **Step 1: Change end-to-end cockpit entry paths**

Replace each cockpit `page.goto("/")` with:

```ts
await page.goto("/demo");
```

In `tests/e2e/dashboard.spec.ts`, add:

```ts
await expect(page).toHaveURL(/\/demo$/u);
```

- [ ] **Step 2: Run the narrow test and verify the new route fails**

Run:

```bash
pnpm exec playwright test tests/e2e/dashboard.spec.ts
```

Expected: FAIL because `/demo` does not exist.

- [ ] **Step 3: Move the cockpit server component**

Create `apps/web/app/demo/page.tsx` with the current `apps/web/app/page.tsx` implementation. Update relative imports to:

```ts
import { loadCockpitInitialState } from "../../lib/cockpit-read-model";
import { requireVeraPageSession } from "../../lib/server/page-session";
import { DemoSearch } from "../demo-search";
```

Change the cockpit Inbox link to:

```tsx
<Link href="/demo">Inbox</Link>
```

Replace `apps/web/app/page.tsx` temporarily with:

```tsx
import Link from "next/link";

export default function LandingPage() {
  return (
    <main>
      <h1>Find a great home faster.</h1>
      <Link href="/demo">Explore the live demo</Link>
    </main>
  );
}
```

- [ ] **Step 4: Route product navigation back to the cockpit**

In each product file where a link labeled Dashboard, Inbox, Listings, or Vera dashboard currently points to `/`, change only that destination:

```tsx
<Link href="/demo">Listings</Link>
```

Preserve every other label, route, and behavior.

- [ ] **Step 5: Hide the demo banner on the public page**

Convert `apps/web/app/demo-banner.tsx` to:

```tsx
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
```

- [ ] **Step 6: Verify the cockpit route**

Run:

```bash
pnpm exec playwright test tests/e2e/dashboard.spec.ts
```

Expected: PASS with the existing cockpit visible at `/demo`.

- [ ] **Step 7: Commit the route separation**

```bash
git add apps/web/app tests/e2e
git commit -m "feat: separate landing and demo routes"
```

### Task 2: Add the approved hero and landing narrative

**Files:**
- Create: `apps/web/app/atlas-hero.tsx`
- Replace: `apps/web/app/page.tsx`
- Create: `apps/web/app/landing-page.module.css`
- Create: `apps/web/public/landing/vera-atlas-hero.png`
- Create: `apps/web/public/landing/vera-evidence-house.png`
- Create: `apps/web/public/landing/vera-product-capture.png`
- Create: `apps/web/public/landing/vera-activity-capture.png`
- Create: `tests/e2e/landing.spec.ts`

**Interfaces:**
- Produces: `AtlasHero(): JSX.Element`, a client leaf with no network or application-state access.
- Consumes: local public images only.
- Produces: semantic landing sections with IDs `product`, `how-it-works`, `safety`, and `veramove`.

- [ ] **Step 1: Add the failing landing-page browser test**

Create `tests/e2e/landing.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("public landing page presents the atlas promise without loading the cockpit", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Find a great home faster." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore the live demo" })).toHaveAttribute(
    "href",
    "/demo"
  );
  await expect(page.getByTestId("atlas-globe")).toBeVisible();
  await expect(page.getByText("Many sources. One search you control.")).toBeVisible();
  await expect(page.getByText("From the right home to the right move.")).toBeVisible();
  await expect(page.getByText("No autonomous outreach.")).toBeVisible();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
});

test("desktop proof card preserves the globe target", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const proof = await page.getByTestId("hero-proof-card").boundingBox();
  const target = await page.getByTestId("atlas-target").boundingBox();
  expect(proof).not.toBeNull();
  expect(target).not.toBeNull();
  expect(proof!.width).toBeLessThanOrEqual(520);

  const overlapsTarget =
    proof!.x < target!.x + target!.width &&
    proof!.x + proof!.width > target!.x &&
    proof!.y < target!.y + target!.height &&
    proof!.y + proof!.height > target!.y;
  expect(overlapsTarget).toBe(false);
});

test("mobile proof follows the globe and reduced motion is static", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const globe = await page.getByTestId("atlas-globe").boundingBox();
  const proof = await page.getByTestId("hero-proof-card").boundingBox();
  expect(globe).not.toBeNull();
  expect(proof).not.toBeNull();
  expect(proof!.y).toBeGreaterThanOrEqual(globe!.y + globe!.height);

  await expect(page.getByTestId("atlas-signal").first()).toHaveCSS("animation-name", "none");
});
```

- [ ] **Step 2: Run the test and verify content is missing**

Run:

```bash
pnpm exec playwright test tests/e2e/landing.spec.ts
```

Expected: FAIL because the approved sections and composition do not exist.

- [ ] **Step 3: Copy the four approved local assets**

Create `apps/web/public/landing/` and copy the four approved PNGs from the visual-companion session without altering their pixels. Verify:

```bash
sips -g pixelWidth -g pixelHeight apps/web/public/landing/*.png
```

Expected:

```text
vera-atlas-hero.png: 1586 x 992
vera-evidence-house.png: 1003 x 1568
vera-product-capture.png: 1672 x 941 (developer badge removed from the approved capture)
vera-activity-capture.png: 1280 x 720
```

- [ ] **Step 4: Implement the client-only atlas artwork**

Create `apps/web/app/atlas-hero.tsx` with a bounded pointer handler:

```tsx
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

  const initialStyle: HeroStyle = { "--pointer-x": "0", "--pointer-y": "0" };

  return (
    <div
      className={styles.atlasStage}
      onPointerMove={updatePointer}
      onPointerLeave={resetPointer}
      style={initialStyle}
    >
      <div className={styles.globeDrift} data-testid="atlas-globe">
        <Image
          src="/landing/vera-atlas-hero.png"
          alt="Search signals converging on a home across a silver digital atlas"
          fill
          priority
          sizes="(max-width: 760px) 100vw, 78vw"
        />
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
```

- [ ] **Step 5: Implement the semantic landing page**

Replace `apps/web/app/page.tsx` with a server component that:

- exports title `Vera | Find fast. Rent safely.`;
- renders the approved hero copy and both calls to action;
- renders the source convergence, product evidence, renter control, VeraMove, and closing sections;
- uses `Image` for all supporting artwork;
- links VeraMove to `https://github.com/zukhriddingit/VeraMove`;
- uses only accurate current-capability copy from the design spec.

The primary route and label must be:

```tsx
<Link className={styles.primaryAction} href="/demo">
  Explore the live demo
</Link>
```

The desktop proof card must be marked:

```tsx
<figure className={styles.heroProof} data-testid="hero-proof-card">
  <Image
    src="/landing/vera-product-capture.png"
    alt="Vera's sanitized listing evidence interface"
    width={1280}
    height={720}
    sizes="(max-width: 760px) calc(100vw - 32px), min(34vw, 520px)"
  />
  <figcaption>Every source retained. Every decision explained.</figcaption>
</figure>
```

- [ ] **Step 6: Implement the approved CSS system**

Create `apps/web/app/landing-page.module.css` with:

```css
.page {
  --night: #050914;
  --night-soft: #0b1220;
  --silver: #f4f6f8;
  --muted: #a7b0c0;
  --line: rgba(207, 219, 235, 0.16);
  --coral: #ff7658;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  color: var(--silver);
  background: var(--night);
}

.hero {
  position: relative;
  min-height: min(920px, 100svh);
  isolation: isolate;
}

.atlasStage {
  --pointer-x: 0;
  --pointer-y: 0;
  position: absolute;
  inset: 5rem -7vw 0 24vw;
  z-index: -1;
}

.globeDrift {
  position: absolute;
  inset: 0;
  transform: translate3d(
    calc(var(--pointer-x) * -8px),
    calc(var(--pointer-y) * -5px),
    0
  );
  animation: globe-breathe 14s ease-in-out infinite alternate;
}

.globeDrift img {
  object-fit: contain;
  object-position: center right;
}

.heroProof {
  position: absolute;
  right: clamp(24px, 4vw, 72px);
  bottom: 28px;
  z-index: 3;
  width: min(34vw, 520px);
  margin: 0;
  animation: proof-rise 900ms 1.65s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

@media (max-width: 760px) {
  .hero {
    min-height: auto;
  }

  .atlasStage {
    position: relative;
    inset: auto;
    width: calc(100% + 32px);
    aspect-ratio: 1.35;
    margin: 24px -16px 0;
  }

  .heroProof {
    position: relative;
    right: auto;
    bottom: auto;
    width: 100%;
    margin-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .globeDrift,
  .signal,
  .target,
  .heroProof,
  .heroCopy > * {
    animation: none;
    transform: none;
  }
}
```

Use the following shared layout and interaction rules for the page:

```css
.nav,
.heroInner,
.sectionInner,
.footerInner {
  width: min(1240px, calc(100% - 48px));
  margin-inline: auto;
}

.nav {
  position: relative;
  z-index: 5;
  display: flex;
  min-height: 80px;
  align-items: center;
  gap: 28px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--silver);
  font-size: 1.05rem;
  font-weight: 780;
  text-decoration: none;
}

.brandMark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  color: var(--night);
  background: var(--coral);
}

.navLinks {
  display: flex;
  gap: 28px;
  margin-left: auto;
}

.navLinks a,
.textAction {
  color: #c7cfdb;
  font-size: 0.84rem;
  font-weight: 680;
  text-decoration: none;
}

.heroInner {
  position: relative;
  z-index: 2;
  min-height: calc(min(920px, 100svh) - 80px);
  padding-top: clamp(100px, 15vh, 164px);
}

.heroCopy {
  width: min(610px, 48vw);
}

.heroCopy > * {
  animation: copy-enter 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.heroCopy > :nth-child(2) {
  animation-delay: 100ms;
}

.heroCopy > :nth-child(3) {
  animation-delay: 180ms;
}

.heroCopy > :nth-child(4) {
  animation-delay: 260ms;
}

.eyebrow {
  margin: 0 0 22px;
  color: var(--coral);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.heroTitle {
  max-width: 600px;
  margin: 0;
  color: var(--silver);
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: clamp(4.2rem, 7.2vw, 7.5rem);
  font-weight: 720;
  letter-spacing: -0.075em;
  line-height: 0.88;
}

.heroBody {
  max-width: 570px;
  margin: 28px 0 0;
  color: var(--muted);
  font-size: clamp(1rem, 1.45vw, 1.22rem);
  line-height: 1.65;
}

.actions {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-top: 30px;
}

.primaryAction {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  padding: 0 22px;
  border-radius: 999px;
  color: #1b0b07;
  background: var(--coral);
  font-size: 0.86rem;
  font-weight: 800;
  text-decoration: none;
}

.truthLabel {
  display: inline-flex;
  margin-top: 26px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: #c7cfdb;
  background: rgba(5, 9, 20, 0.58);
  font-size: 0.72rem;
}

.section {
  position: relative;
  padding: clamp(88px, 11vw, 160px) 0;
  border-top: 1px solid var(--line);
}

.sectionHeader {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(300px, 0.55fr);
  gap: clamp(40px, 8vw, 120px);
  align-items: end;
  margin-bottom: 56px;
}

.sectionTitle {
  max-width: 760px;
  margin: 0;
  color: var(--silver);
  font-size: clamp(2.8rem, 5.3vw, 5.8rem);
  font-weight: 680;
  letter-spacing: -0.06em;
  line-height: 0.96;
}

.sectionBody {
  margin: 0;
  color: var(--muted);
  line-height: 1.75;
}

.proofGrid,
.controlGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.panel {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 26px;
  background: var(--night-soft);
}

.panelCopy {
  padding: clamp(28px, 4vw, 52px);
}

.panelCopy h3 {
  margin-bottom: 12px;
  color: var(--silver);
  font-size: 1.25rem;
}

.panelCopy p,
.panelCopy li,
.footerCopy {
  color: var(--muted);
  line-height: 1.7;
}

.primaryAction:hover,
.primaryAction:focus-visible {
  background: #ff8a70;
  transform: translateY(-1px);
}

.brand:focus-visible,
.navLinks a:focus-visible,
.textAction:focus-visible,
.primaryAction:focus-visible {
  outline: 3px solid rgba(255, 118, 88, 0.48);
  outline-offset: 4px;
}

@media (max-width: 760px) {
  .nav,
  .heroInner,
  .sectionInner,
  .footerInner {
    width: min(100% - 32px, 1240px);
  }

  .navLinks {
    display: none;
  }

  .nav .primaryAction {
    margin-left: auto;
  }

  .heroInner {
    min-height: auto;
    padding-top: 70px;
  }

  .heroCopy {
    width: 100%;
  }

  .heroTitle {
    max-width: 360px;
    font-size: clamp(3.6rem, 17vw, 5.25rem);
  }

  .heroBody {
    font-size: 1rem;
  }

  .sectionHeader,
  .proofGrid,
  .controlGrid {
    grid-template-columns: 1fr;
  }

  .sectionHeader {
    gap: 24px;
    margin-bottom: 36px;
  }
}
```

Define the motion primitives without animating layout properties:

```css
@keyframes copy-enter {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes proof-rise {
  from {
    opacity: 0;
    transform: translateY(44px) rotate(1.5deg);
  }
  to {
    opacity: 1;
    transform: translateY(0) rotate(0);
  }
}

@keyframes signal-travel {
  0%,
  18% {
    opacity: 0;
    transform: translateX(0) scale(0.7);
  }
  28% {
    opacity: 1;
  }
  72% {
    opacity: 1;
  }
  82%,
  100% {
    opacity: 0;
    transform: translateX(var(--signal-distance)) scale(1);
  }
}

@keyframes target-pulse {
  0%,
  62% {
    box-shadow: 0 0 0 0 rgba(255, 118, 88, 0);
    transform: scale(0.8);
  }
  72% {
    box-shadow: 0 0 0 18px rgba(255, 118, 88, 0);
    transform: scale(1.15);
  }
  82%,
  100% {
    box-shadow: 0 0 0 0 rgba(255, 118, 88, 0);
    transform: scale(1);
  }
}

@keyframes globe-breathe {
  from {
    scale: 1;
  }
  to {
    scale: 1.015;
  }
}
```

- [ ] **Step 7: Verify desktop, mobile, and reduced motion**

Run:

```bash
pnpm exec playwright test tests/e2e/landing.spec.ts
```

Expected: all three landing tests PASS.

- [ ] **Step 8: Commit the landing experience**

```bash
git add apps/web/app apps/web/public/landing tests/e2e/landing.spec.ts
git commit -m "feat: add animated atlas landing page"
```

### Task 3: Preserve the full deterministic product flow

**Files:**
- Modify: `tests/e2e/demo.spec.ts`
- Modify: `tests/e2e/inbox.spec.ts`
- Modify: `tests/e2e/viewing-calendar-hold.spec.ts`
- Modify: any assertions that expect `/` after a product-navigation action.

**Interfaces:**
- Consumes: `/demo` cockpit from Task 1.
- Preserves: eight canonical listings, three duplicate clusters, shortlist, dismiss, viewing, Calendar mock, and activity behavior.

- [ ] **Step 1: Run the affected product flows**

Run:

```bash
pnpm exec playwright test \
  tests/e2e/demo.spec.ts \
  tests/e2e/inbox.spec.ts \
  tests/e2e/viewing-calendar-hold.spec.ts
```

Expected: PASS. Fix only route expectations or link destinations caused by the route split.

- [ ] **Step 2: Run the full browser suite**

Run:

```bash
pnpm test:e2e
```

Expected: PASS with no live marketplace, Google, email, or messaging side effect.

- [ ] **Step 3: Commit any route-only regression fixes**

```bash
git add apps/web/app tests/e2e
git commit -m "test: preserve demo flow under demo route"
```

### Task 4: Documentation and release verification

**Files:**
- Modify: `docs/DEMO.md`
- Modify: `README.md` only if its first-run route is `/`.

**Interfaces:**
- Produces: contributor instructions that distinguish the public landing route from the deterministic demo route.

- [ ] **Step 1: Update the demo recording route**

In `docs/DEMO.md`, replace product-flow instructions that say to open `/` with `/demo`. Add:

```markdown
The public website is available at `/`. The deterministic cockpit and recording flow begin at
`/demo`. The landing route has no database, session, or external integration dependency.
```

- [ ] **Step 2: Run static and test verification**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 3: Review the rendered page**

At 1440 x 1000 verify:

- the globe target remains unobstructed;
- the proof card is at most 520 pixels wide;
- the CTA is visible without scrolling;
- the generated images load;
- the product capture remains legible without dominating the globe.

At 390 x 844 verify:

- no horizontal scroll;
- navigation collapses cleanly;
- the proof card begins below the globe;
- all copy, links, and focus states remain usable.

With reduced motion verify the final states render immediately and no signal, pulse, drift, or entrance animation runs.

- [ ] **Step 4: Review truth and safety boundaries**

Search the landing source for unsupported claims:

```bash
rg -n "send|book|payment|live marketplace|scam|autonomous" apps/web/app/page.tsx
```

Expected: only explicit negative or safety-boundary language. Confirm no secrets, contact information, or real listing data exist in the page or images.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/DEMO.md README.md
git commit -m "docs: add public landing route"
```

- [ ] **Step 6: Final diff review**

Run:

```bash
git status --short
git diff HEAD~4 --check
git log -4 --oneline
```

Expected: clean worktree, no whitespace errors, and focused commits for design, route separation, landing page, tests, and docs.
