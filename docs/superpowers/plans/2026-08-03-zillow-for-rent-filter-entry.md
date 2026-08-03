# Zillow For-Rent Filter Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support Zillow's current exact `For rent` filter entry while safely closing a stale `More filters` panel.

**Architecture:** Extend only saved-profile UI entry selection inside the Vera-owned bounded adapter. All actions continue through `activateControl`, which re-runs the existing checkpoint, exact-tab, hostname, limit, and cancellation gates.

**Tech Stack:** Node.js 24, JavaScript ESM, TypeScript Vitest tests, pnpm.

## Global Constraints

- Preserve the complete accepted 13A transport, pairing, consent-tab, revocation, UID/GID, restart, and route-isolation architecture.
- Preserve the strict versioned tool input/output contracts and all Zillow run caps.
- Never expose generic browser actions or add arbitrary URLs, selectors, JavaScript, coordinates, credentials, cookies, uploads, or downloads.
- Any missing or duplicate reviewed marker returns `manual_action_required` with `layout_changed`.
- Publish at most one candidate-9 digest after green hosted CI; retain every prior digest unchanged.

---

### Task 1: Add the exact current-layout entry path

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.mjs`
- Test: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

**Interfaces:**
- Consumes: parsed Zillow semantic snapshots and the existing `activateControl`, `takeSnapshot`, `findReviewedControl`, and `findUniqueReviewedControl` helpers.
- Produces: `closeStaleMoreFilters(document, state, dependencies)` and deterministic entry priority `Price` → `For rent` → `Filters`.

- [ ] **Step 1: Write failing current-layout tests**

Extend the fixture state machine with exact `More filters`/`Close` and `For rent` controls. Assert the action sequence closes `More filters`, submits location, clicks `For rent`, fills only the saved criteria, and applies the exact result-count button. Add duplicate and partial signature cases that return `layout_changed` with no unsafe click.

- [ ] **Step 2: Run the focused red tests**

Run:

```bash
pnpm exec vitest run --project unit infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
```

Expected: the new current-layout success case fails because the adapter does not close the stale panel or select `For rent`.

- [ ] **Step 3: Implement the narrow helper and entry priority**

Add a helper with this contract:

```js
async function closeStaleMoreFilters(document, state, dependencies) {
  const headings = document.refs.filter(
    (entry) => entry.role === "heading" && /^More filters$/iu.test(entry.name)
  );
  const closeButtons = document.refs.filter(
    (entry) => entry.role === "button" && /^Close$/iu.test(entry.name)
  );
  if (headings.length === 0 && closeButtons.length === 0) return document;
  if (headings.length !== 1 || closeButtons.length !== 1) throw layoutChanged();
  await activateControl(closeButtons[0], { kind: "click" }, state, dependencies);
  return takeSnapshot(state, dependencies);
}
```

Call it before location selection. When the exact standalone price button is absent, require a
unique exact `For rent` button when present; otherwise retain the unique exact `Filters` fallback.
Pass that entry control into the existing consolidated-filter function. Do not change accepted
maximum-price, room, property-type, or apply labels.

- [ ] **Step 4: Run focused and affected suites**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts \
  infra/maritime/openclaw/vera-zillow-rental-research/policy.unit.test.ts \
  infra/maritime/openclaw/vera-zillow-rental-research/restart.unit.test.ts
pnpm verify:browser-boundaries
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm lint
pnpm typecheck
pnpm format:check
```

Expected: all checks pass and serialized action bodies contain none of the forbidden actions.

- [ ] **Step 5: Commit**

```bash
git add infra/maritime/openclaw/vera-zillow-rental-research/index.mjs \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
git commit -m "fix: enter Zillow for-rent filters"
```

### Task 2: Release and rerun live acceptance

**Files:**
- Private gitignored evidence under `release-evidence/private/m13b-zillow-20260731-01/` only.

**Interfaces:**
- Consumes: green merged main SHA and the protected Gateway release workflow.
- Produces: one candidate-9 immutable digest plus real normalized/scored Zillow inbox evidence or a typed fail-closed result.

- [ ] **Step 1: Push the branch and require green hosted CI**

Open a focused PR, wait for workspace verification, complete tests/build, Gateway image build, and
zero-HIGH/CRITICAL scan. Merge only the exact green head.

- [ ] **Step 2: Publish and independently verify candidate 9**

Create the temporary package credential secret through stdin without printing it, dispatch the
manual release for the exact merged main SHA, then immediately delete the repository secret and
revoke the temporary credential. Verify the immutable digest, source binding, runtime layout,
Cosign signature, SPDX SBOM, SLSA provenance, and zero HIGH/CRITICAL findings.

- [ ] **Step 3: Deploy and run the real founder acceptance**

Change only the digest and source revision in a copy of the proven bootstrap. Verify UID/GID
`1000:1000`, VPC-only `18789`, public WSS route isolation, and exactly one shared Zillow tab. Run
the saved Boston profile through the real Vera pipeline and require at least one inbox listing with
RawListing identity, normalization, provenance, dedupe, fit score, missing facts, risk indicators,
and no forbidden action.

- [ ] **Step 4: Prove revocation and clean up**

After success, require the founder to unshare the tab, verify `no_shared_tab`, revoke pairing, close
operator SSH, and delete all disposable infrastructure and credential material. Record zero
remaining billable resources and a clean tracked worktree.
