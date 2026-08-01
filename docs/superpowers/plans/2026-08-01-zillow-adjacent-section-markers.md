# Zillow Adjacent Section Markers Implementation Plan

> **For agentic workers:** Execute these focused steps inline; the recommended plan-execution
> sub-skills are unavailable in this session.

**Goal:** Accept only Zillow's observed adjacent same-name `group` -> `text` section markers while
preserving fail-closed ambiguity handling.

**Architecture:** Extend semantic-line parsing with a role, resolve each section boundary as either
one marker or one exact adjacent parent/child pair, and keep the existing section-scoped control
selection and public contracts unchanged.

**Tech Stack:** Node.js ESM, TypeScript/Vitest, OpenClaw semantic snapshots, pnpm.

## Constraints

- Do not change `vera_zillow_rental_research_v1` input/output schemas or add browser operations.
- Coalesce only adjacent, same-name, ordered `group` then `text` markers.
- Reject gaps, reverse order, name mismatches, missing markers, and additional matches.
- Preserve all founder, policy, kill-switch, consent-tab, hostname, cancellation, and run-limit checks.
- Publish at most the one explicitly authorized seventh candidate after green hosted CI.

### Task 1: Add regression coverage

**File:** `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

- [ ] Extend the current room fixture with optional adjacent marker pairs and malformed variants.
- [ ] Assert the observed pair selects the exact saved bedroom and bathroom references.
- [ ] Assert separated, reversed, mismatched, and extra matching markers return
  `manual_action_required/layout_changed`, emit no room-value actions, and contain no forbidden
  action text.
- [ ] Run the focused test and confirm the observed pair is red before implementation:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
```

### Task 2: Implement the narrow boundary resolver

**File:** `infra/maritime/openclaw/vera-zillow-rental-research/zillow-snapshot.mjs`

- [ ] Parse each semantic line's role as well as its cleaned name and reference.
- [ ] Resolve start/end boundaries using one unique marker or one exact adjacent same-name
  `group` -> `text` pair.
- [ ] Treat an adjacent structural counterpart with a different name as invalid, even if only one
  line matches the reviewed pattern.
- [ ] Keep the existing unique in-section control match and forbidden-control guard unchanged.
- [ ] Run the focused test and confirm green.

### Task 3: Verify and review

**Files:** the focused parser, test, design, and plan files only.

- [ ] Run the seven affected Vitest files, lint, typecheck, Gateway supply-chain verification,
  remote-extension verification, and release-workflow verification.
- [ ] Run `git diff --check`, inspect the diff for secrets and capability expansion, then commit the
  focused repair.
- [ ] Push, open the PR, wait for hosted CI, and merge only when all checks are green.

### Task 4: Publish and accept candidate 7

- [ ] Obtain the temporary publish credential through the manual secret flow without exposing it.
- [ ] Publish exactly one immutable candidate from the merged revision; verify digest, signature,
  SBOM, provenance, and zero HIGH/CRITICAL findings.
- [ ] Redeploy the existing disposable 13A-shaped stack using only the new digest/source revision.
- [ ] Re-share exactly one reset Zillow rental tab, complete the Boston run and Vera import, then
  unshare, prove browsing stops, revoke pairing, and clean all disposable resources and credentials.
