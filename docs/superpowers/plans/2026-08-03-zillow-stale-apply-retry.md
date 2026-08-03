# Zillow Stale Apply Reference Retry Implementation Plan

**Goal:** Recover once from Zillow's exact post-snapshot semantic-reference invalidation without
retrying any ambiguous browser action.

### Task 1: Add failing contract tests

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

- [x] Model a fresh room-apply reference that receives the exact stale-reference 503.
- [x] Assert a new snapshot supplies a changed reference and exactly one retry completes.
- [x] Assert a second stale response and an unknown 503 both fail closed without another retry.

### Task 2: Implement the exact bounded recovery

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.mjs`

- [x] Parse only the bounded exact internal stale-reference error.
- [x] Refresh and require a changed reviewed apply reference.
- [x] Retry through `activateControl` once; preserve ambiguous-response behavior.
- [x] Run focused/full tests and all source, type, lint, and format gates.

### Task 3: Release and accept

- [ ] Merge only after all hosted checks are green.
- [ ] Publish, sign, attest, SBOM, and zero-scan one new immutable candidate from the merged SHA.
- [ ] Deploy only the digest/source change to the disposable Gateway.
- [ ] Rerun WSS and real Boston Zillow ingestion.
- [ ] Verify unshare stops browsing, revoke pairing, and remove all disposable infrastructure.
