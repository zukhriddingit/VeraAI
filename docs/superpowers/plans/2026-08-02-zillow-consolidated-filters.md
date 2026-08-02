# Zillow Consolidated Filters Implementation Plan

> **For agentic workers:** Execute these focused steps inline; do not widen the browser tool or use
> generic browser operations.

**Goal:** Support Zillow's exact consolidated `Filters` dialog while preserving the existing
standalone controls and every bounded browser-research invariant.

**Architecture:** Add a layout discriminator after the location snapshot. Keep the current
standalone flow unchanged; otherwise open one unique exact Filters button, set only reviewed saved-
profile controls in the shared dialog, and apply once at the end.

**Tech Stack:** Node.js ESM, TypeScript/Vitest, OpenClaw semantic snapshots, pnpm.

## Global Constraints

- Do not change `vera_zillow_rental_research_v1` input/output schemas or browser operations.
- Accept only an exact unique `button "Filters"` fallback when the standalone Price control is absent.
- Set only saved-profile maximum rent, bedrooms, bathrooms, and rental property type.
- Preserve founder policy, kill switch, cancellation, consent-tab, hostname, run, navigation, and extraction limits.
- Preserve all forbidden-action guards and manual blocker behavior.
- Publish candidate 8 only after focused, affected, and hosted CI gates are green.

---

### Task 1: Consolidated-layout regressions

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

**Interfaces:**
- Consumes: existing semantic snapshot fixtures and `runVeraZillowRentalResearch` harness.
- Produces: regression coverage for the exact consolidated filter sequence and fail-closed variants.

- [ ] Add a fixture with a unique Filters button, maximum-rent input, scoped bedroom/bathroom values,
  property-type control, and one reviewed final apply button.
- [ ] Assert exact saved-profile actions occur in order and final apply occurs once.
- [ ] Assert missing/duplicate Filters and ambiguous/missing inner controls return
  `manual_action_required/layout_changed` without forbidden actions.
- [ ] Run the focused unit file and confirm the valid consolidated case is red before implementation:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
```

### Task 2: Minimal consolidated filter path

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.mjs`

**Interfaces:**
- Consumes: existing `findReviewedControl`, `findReviewedControlInSection`, `activateControl`,
  `takeSnapshot`, and saved-profile fields.
- Produces: a private consolidated-layout helper used only when the standalone Price button is absent.

- [ ] Select one exact unique Filters button and open it through `activateControl`.
- [ ] Set maximum rent and supplied bedroom/bathroom/property-type fields using existing semantic
  control matching and section scoping.
- [ ] Apply once using the existing reviewed Done/Save/See-results matcher, then take a fresh snapshot.
- [ ] Preserve the standalone path byte-for-byte where practical and return `layout_changed` for any
  missing or ambiguous consolidated control.
- [ ] Run the focused unit file and confirm green.

### Task 3: Verification and immutable release

**Files:** the focused adapter, tests, design, and plan only.

**Interfaces:**
- Consumes: repository verification scripts and the existing candidate release workflow.
- Produces: merged green main and one signed, attested candidate-8 digest.

- [ ] Run affected unit/contract/policy/restart suites, lint, typecheck, Gateway supply-chain,
  remote-extension, and release-workflow verifiers.
- [ ] Run `git diff --check`; review for secrets, unrelated changes, and capability expansion.
- [ ] Commit, push, open the focused PR, wait for hosted CI, and merge only when green.
- [ ] Publish candidate 8 from the exact merge revision and verify signature, SBOM, provenance,
  digest, and zero HIGH/CRITICAL scan findings.

### Task 4: Live acceptance and cleanup

**Files:** private gitignored evidence only.

**Interfaces:**
- Consumes: the proven disposable DigitalOcean stack, official extension, and bounded live harness.
- Produces: real Zillow import evidence, revocation evidence, and zero-resource cleanup readback.

- [ ] Deploy candidate 8 with the proven 13A scripts and verify immutable runtime/transport gates.
- [ ] Run one real Boston search, import at least one listing, and prove RawListing, normalization,
  provenance, dedupe, scoring, inbox presentation, and no forbidden actions.
- [ ] Unshare and prove further browser work stops, revoke pairing, remove operator access, and clean
  all disposable infrastructure and temporary credentials.
