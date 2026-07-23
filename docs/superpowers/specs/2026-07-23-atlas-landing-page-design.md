# Atlas Landing Page Design

Status: approved for implementation  
Date: 2026-07-23

## Goal

Create a public Vera landing page that makes the product promise immediately legible, gives the founder application a credible website, and leads visitors into the existing deterministic product demo without overstating live capabilities.

The approved creative direction is **atlas to address**: scattered search signals travel across a dark silver globe and converge on one home. The sequence communicates Vera's core value before any product detail appears.

## Route boundary

- `/` becomes the public landing page and must not require a Vera session or database read.
- `/demo` becomes the existing decision cockpit route.
- Product pages link back to `/demo` when their label means Listings, Inbox, or Dashboard.
- The public landing page links to `/demo` as the primary product proof.
- No acquisition, policy, persistence, or external-action behavior changes in this slice.

## Visual direction

The page uses a blue-black night palette, silver-white typography, and one solar-coral accent. It must not reuse the existing forest green as the landing-page brand color and must not introduce a second decorative accent.

The visual system is cinematic but controlled:

- crisp sans-serif display type with tight tracking;
- near-black blue surfaces instead of pure black;
- thin cool-gray borders and restrained glass effects;
- rounded rectangles with one consistent corner family;
- generated globe and evidence-house artwork used as editorial illustrations;
- real sanitized Vera UI used only as product evidence;
- no generic AI gradients, glowing purple, floating icon fields, fake testimonials, or decorative analytics.

## Hero composition

Desktop is composed in three visual layers:

1. A full-bleed silver globe is the dominant object, positioned center-right.
2. Copy sits in a bounded left column and never crosses the globe's route target.
3. A small product proof card enters from the lower-right edge only after the route convergence.

The proof card must not repeat the oversized preview from the concept screen. At widths of 1100 pixels and above it is capped at `min(34vw, 520px)`, stays in the lower-right quadrant, and may overlap only the globe's lower edge. It must not cover the primary route convergence, the bright home target, or more than roughly one quarter of the visible globe. The first stable hero frame should still read clearly with the proof card removed.

Approved hero copy:

- Eyebrow: `FIND FAST. RENT SAFELY.`
- Heading: `Find a great home faster.`
- Body: `Vera turns scattered listings into one evidence-backed search, so renters can compare fit, missing facts, and risk before taking action.`
- Primary action: `Explore the live demo`
- Secondary action: `See how Vera works`

The hero also carries a plain-language demo label: `Sanitized data. Deterministic decisions. No autonomous outreach.`

## Motion behavior

Motion explains the workflow instead of decorating it:

1. The hero copy enters with a short stagger.
2. Three coral search signals travel toward the home target.
3. The target pulses once when the signals converge.
4. The proof card rises slightly from the lower-right edge.
5. The globe continues only a very slow camera drift and pointer parallax.

The globe artwork remains a static generated image. CSS transforms and small HTML signal elements provide the motion, avoiding a large rendering dependency and preserving the exact approved visual. Pointer parallax is subtle, bounded, and disabled on coarse pointers.

With `prefers-reduced-motion: reduce`, all route travel, entrance transforms, pulsing, parallax, and continuous drift stop. The final visual state is rendered immediately.

## Responsive behavior

At tablet widths, the copy remains above the globe and the proof card becomes a smaller bottom-right card.

Below 760 pixels:

- navigation collapses to the brand and primary action;
- the heading remains at most three lines;
- the globe becomes a contained visual below the copy;
- signal motion stays within the globe bounds;
- the proof card joins normal document flow below the globe and cannot overlap it;
- decorative pointer parallax is disabled.

The mobile page must not rely on hover and must preserve a visible focus ring.

## Page structure

### 1. Hero

The globe, approved copy, calls to action, and demo truth label establish the promise and motion direction.

### 2. Source convergence

Headline: `Many sources. One search you control.`

Explain that Vera accepts approved official APIs, email alerts, local-browser captures, and user captures through fail-closed policies. Show the deterministic sequence from source record to human-approved action. Do not imply broad crawling or live platform integrations.

### 3. Product evidence

Headline: `Know why this home stands out.`

Use the sanitized Vera interface image and concise proof points:

- every original source remains inspectable;
- unknown facts remain unknown;
- duplicate evidence is clustered, not deleted;
- fit and risk reasons remain separate and explainable.

### 4. Renter control

Headline: `Fast does not mean automatic.`

Explain that Vera prepares the next step while the renter approves external actions. The page must state that the current repository has no Gmail send path and that the deterministic demo creates no real marketplace or Calendar side effects.

### 5. VeraMove

Headline: `From the right home to the right move.`

Present VeraMove as an additional feature in development, not a shipped production integration. Accurate copy may say that it turns one versioned move plan into three synthetic vendor comparisons with evidence-backed ranking. It must not claim live vendor calls, booking, payments, or production readiness.

Link to `https://github.com/zukhriddingit/VeraMove` with the label `View the VeraMove prototype`.

### 6. Closing action

Headline: `Your housing search should move at your speed.`

Repeat the live-demo action and the product promise. Avoid lead-capture forms until there is a real submission destination.

## Assets

Landing assets live under `apps/web/public/landing/`:

- `vera-atlas-hero.png`: approved generated silver globe with coral routes;
- `vera-evidence-house.png`: approved generated layered-home illustration;
- `vera-product-capture.png`: sanitized screenshot from the deterministic Vera demo;
- `vera-activity-capture.png`: sanitized screenshot of the append-only activity view.

All images require useful alternative text. Decorative overlays use `aria-hidden="true"`.

## Accessibility and performance

- Use semantic landmarks and one page-level `h1`.
- Maintain WCAG AA contrast for body copy, controls, and focus indicators.
- Every interactive element is keyboard reachable.
- The page remains understandable with images disabled.
- Use `next/image` with explicit dimensions or `fill` plus `sizes`.
- The globe may be the priority image; supporting images must lazy-load.
- No autoplay audio or video.
- No client-side dependency is added solely for motion.

## Acceptance

1. `/` renders without session, database, or external API access.
2. `/demo` preserves the current deterministic cockpit behavior.
3. Desktop hero keeps the globe's bright target and route convergence unobstructed.
4. The product proof card is no wider than `min(34vw, 520px)` on large desktop and moves into normal flow on mobile.
5. The approved hero sequence animates with CSS and becomes static under reduced motion.
6. The landing page uses only the silver, blue-black, and coral visual system.
7. Vera and VeraMove claims match the current repository and prototype boundaries.
8. Navigation, focus states, headings, alternative text, and mobile layout pass browser review.
9. Unit, integration, end-to-end, typecheck, lint, format, and build checks continue to pass.
