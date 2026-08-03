# Zillow Browser-Control Timeout Implementation Plan

**Goal:** Allow the bounded Zillow adapter to tolerate observed browser-control latency without
weakening its 90-second run limit or safe-action boundary.

**Architecture:** Change one internal request timeout. The existing remaining-run calculation stays
authoritative, and all actions continue through the same checkpoint, authorization, exact-tab,
hostname, cancellation, and limit checks.

### Task 1: Add the timeout contract

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

- [ ] Assert every semantic snapshot carries `timeoutMs=15000`.
- [ ] Run the focused test and confirm it fails against the current 5-second value.

### Task 2: Implement and verify the repair

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.mjs`

- [ ] Change only `REQUEST_TIMEOUT_MS` from `5_000` to `15_000`.
- [ ] Run focused Zillow unit, policy, and restart tests.
- [ ] Run browser/Gateway boundary checks, lint, typecheck, and format verification.
- [ ] Review the diff for new actions, URLs, secrets, or policy regressions.

### Task 3: Release and rerun acceptance

- [ ] Open a focused PR and require green hosted CI.
- [ ] Publish exactly one signed immutable candidate from the merged SHA and verify digest, SBOM,
      provenance, and zero HIGH/CRITICAL scan.
- [ ] Reuse the proven disposable DigitalOcean architecture with only the candidate digest/source
      changed, then rerun public WSS and real founder Boston Zillow acceptance.
- [ ] Import at least one listing through RawListing, normalization, dedupe, scoring, and inbox.
- [ ] Verify no forbidden action, then unshare, revoke pairing, and clean up all disposable state.
