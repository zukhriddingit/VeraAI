# Founder-core release profile implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vera's founder release gate profile-aware so browser-disabled founder core can be
classified independently from the blocked browser experiment.

**Architecture:** A focused release-profile registry owns the exact capabilities, phase sets,
configuration-blocker eligibility, and classification enum. Evidence schema version 2 and release
manifest schema version 2 bind that registry data to canonical hashes. The smoke gate consumes the
same registry, while the product browser controls boundary rejects latent enablement under the
global kill switch.

**Tech Stack:** TypeScript 6, Node.js 24, Vitest 4, JSON Schema 2020-12, pnpm workspaces, Markdown
operator procedures.

## Global constraints

- Do not dispatch a workflow, deploy infrastructure, deploy an OpenClaw gateway, or expose a
  Maritime agent.
- Do not enable browser execution or weaken the browser-enabled release gate.
- Do not inspect, print, or commit secret values or real environment-specific evidence.
- Keep `release-evidence/private/` gitignored; require directory mode `0700` and file mode `0600`.
- Derive capabilities from exactly `founder_core` or `founder_browser_experimental`; never accept
  operator capability overrides.
- Keep `founder_browser_experimental` classified `no_go` until ADR 0012 is superseded and its code
  restriction is reviewed.
- Treat `not_applicable_with_approved_reason` as a non-passing mandatory result.
- A valid configuration blocker may represent only an external staging value, external credential,
  external deployment, or operator execution and may not require repository or design work.
- Do not add a dependency.

---

## File map

- Create `scripts/staging/release-profiles.ts`: profile registry, phase registry, exact capability
  checks, configuration-blocker vocabulary, and pure result-state classification.
- Create `scripts/staging/release-profiles.unit.test.ts`: table-driven profile and classification
  tests.
- Modify `scripts/staging/release-evidence.ts`: schema-version-2 TypeScript contracts, profile
  binding, blocker validation, freshness validation, classification, and sanitized decision summary.
- Modify `scripts/staging/release-evidence.schema.json`: matching closed JSON Schema.
- Modify `scripts/staging/release-evidence.unit.test.ts`: hashing, mismatch, stale, blocker, and
  synthetic fixture regression tests.
- Modify `scripts/staging/examples/synthetic-evidence-bundle.json` and
  `scripts/staging/examples/synthetic-manual-evidence.json`: version-2 synthetic, non-releasable
  examples.
- Modify `scripts/staging/founder-release-smoke.ts`: profile-derived phase execution and exact final
  classifications.
- Modify `scripts/staging/founder-release-smoke.unit.test.ts`: profile parsing, missing-runner,
  config-blocker, and browser-experimental tests.
- Modify `apps/web/lib/browser-agent-service.ts`: deny control enablement while the global browser
  switch is active.
- Modify `apps/web/lib/browser-agent-service.unit.test.ts`: prove no repository write occurs on that
  denial.
- Modify `infra/maritime/release-manifest.schema.json`: schema-version-2 profile/capability binding
  and profile-specific OpenClaw nullability.
- Modify `scripts/verify-release-manifest.ts`: mirror the schema's profile-specific validation.
- Modify `scripts/verify-release-manifest.unit.test.ts` and
  `scripts/verify-worker-release-promotion.unit.test.ts`: manifest regression coverage.
- Create `docs/FOUNDER_CORE_STAGING_RUNBOOK.md`: exact artifact preflight, phased staging sequence,
  evidence checklist, rollback, and retention handoff.
- Modify `docs/RELEASE_READINESS.md`, `docs/FOUNDER_STAGING_EVIDENCE.md`,
  `docs/SECURITY_REVIEW.md`, `docs/DECISIONS/0012-founder-staging-openclaw-ingress.md`,
  `infra/maritime/README.md`, `infra/maritime/ENVIRONMENT.md`, `infra/maritime/TOPOLOGY.md`, and
  `infra/maritime/COSTS.md`: reconcile the browser-disabled core topology.
- Modify `scripts/verify-release-documentation.ts` and its unit test: require the new runbook and
  profile language.

### Task 1: Profile and classification registry

**Files:**

- Create: `scripts/staging/release-profiles.ts`
- Create: `scripts/staging/release-profiles.unit.test.ts`

**Interfaces:**

- Produces:
  - `RELEASE_PROFILE_IDS`
  - `RELEASE_PROFILES`
  - `RELEASE_PHASES`
  - `releaseProfileDefinition(profileId: ReleaseProfileId): ReleaseProfileDefinition`
  - `capabilitiesMatchProfile(profileId: ReleaseProfileId, capabilities: unknown): boolean`
  - `classifyRequiredPhaseStates(profileId, states): ReleaseClassification`
  - `ReleaseProfileId`, `ReleaseCapabilities`, `ReleasePhaseId`, `ReleaseClassification`

- [ ] **Step 1: Write table-driven failing tests**

Cover exact profile capabilities and these classifier rows:

```ts
const cases = [
  ["all required pass", all("passed_automated"), "go_founder_only_core_beta"],
  [
    "manual pass and valid block",
    replace(all("passed_manual_evidence"), livePhase, "blocked_missing_configuration"),
    "conditional_go_founder_only_staging"
  ],
  ["failed assertion", replace(all("passed_automated"), livePhase, "failed_assertion"), "no_go"],
  ["failed provider", replace(all("passed_automated"), livePhase, "failed_provider"), "no_go"],
  [
    "mandatory N/A",
    replace(all("passed_automated"), livePhase, "not_applicable_with_approved_reason"),
    "no_go"
  ]
] as const;
```

Also prove a missing required state and any browser-experimental state map classify `no_go`.

- [ ] **Step 2: Run the new test and verify failure**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/release-profiles.unit.test.ts
```

Expected: fail because `release-profiles.ts` does not exist.

- [ ] **Step 3: Implement the closed registry**

Define frozen profile objects with exact capabilities and required phases. Define each phase's label,
capability, evidence mode, and `configurationBlockerAllowed` Boolean. Reject missing, duplicate, and
unexpected state rows in `classifyRequiredPhaseStates`.

- [ ] **Step 4: Run the focused test**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/release-profiles.unit.test.ts
```

Expected: all table rows pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/staging/release-profiles.ts scripts/staging/release-profiles.unit.test.ts
git commit -m "feat: add founder release profile registry"
```

### Task 2: Profile-bound evidence and final classification

**Files:**

- Modify: `scripts/staging/release-evidence.ts`
- Modify: `scripts/staging/release-evidence.schema.json`
- Modify: `scripts/staging/release-evidence.unit.test.ts`
- Modify: `scripts/staging/examples/synthetic-evidence-bundle.json`
- Modify: `scripts/staging/examples/synthetic-manual-evidence.json`

**Interfaces:**

- Consumes:
  - `releaseProfileDefinition`
  - `capabilitiesMatchProfile`
  - `classifyRequiredPhaseStates`
- Produces:
  - `ReleaseEvidenceRecord` schema version 2
  - `ReleaseEvidenceBundle` schema version 2
  - `ConfigurationBlocker`
  - `classifyEvidenceBundle(bundle, decisionAt): ReleaseClassification`
  - `createReleaseDecisionSummary(bundle, approvalTimestamp): ReleaseDecisionSummary`

- [ ] **Step 1: Add failing table-driven evidence tests**

Build records through `withRecordContentHash`, then bundles through `withBundleContentHash`. Cover:

```ts
const invalidMutations = [
  ["missing hash", (record) => omit(record, "contentHash")],
  ["modified after hash", (record) => ({ ...record, observedResult: "Changed result" })],
  ["mixed commit", (record) => ({ ...record, sourceCommit: OTHER_COMMIT })],
  ["mixed environment", (record) => ({ ...record, environmentId: "other-stage" })],
  ["mixed profile", (record) => ({ ...record, releaseProfile: "founder_browser_experimental" })],
  ["mixed capabilities", (record) => ({ ...record, capabilities: BROWSER_CAPABILITIES })],
  ["mixed worker digest", (record) => ({ ...record, candidateWorkerImage: OTHER_WORKER })]
] as const;
```

Add rows for missing mandatory phase, immutable-image rejection, stale bundle, stale record, all
failure states, invalid blocker shape, prohibited blocker descriptions, and deterministic hash
ordering. Prove synthetic examples fail production validation and pass only with `allowSynthetic`.

- [ ] **Step 2: Run the focused evidence test and verify failure**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/release-evidence.unit.test.ts
```

Expected: schema-version/profile/blocker assertions fail against version 1.

- [ ] **Step 3: Implement version-2 TypeScript validation**

Require the profile and exact capability object in every record and bundle. Require null OpenClaw
digests for core and immutable digests for browser experimental. Validate configuration blockers
only for eligible phases and only with the approved closed object. Validate record times against
bundle creation and the explicit decision instant with `MAX_EVIDENCE_AGE_MILLISECONDS` equal to
seven days.

- [ ] **Step 4: Implement classification and summary**

`classifyEvidenceBundle` validates the entire bundle, freshness, exact required phase set, and then
calls the pure state classifier. `createReleaseDecisionSummary` accepts only the two founder-core go
classifications, includes no private records, and preserves nullable OpenClaw digest truthfully.

- [ ] **Step 5: Update the JSON Schema and synthetic examples**

Use `additionalProperties: false` at every object level, `$defs` for capabilities and configuration
blockers, profile-conditional OpenClaw rules, and explicit `synthetic: true` plus non-releasable
descriptions in committed examples. Recompute every canonical record and bundle hash with the
TypeScript helper.

- [ ] **Step 6: Run evidence tests and schema formatting**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/release-evidence.unit.test.ts
./node_modules/.bin/prettier --check scripts/staging/release-evidence.ts scripts/staging/release-evidence.schema.json scripts/staging/release-evidence.unit.test.ts scripts/staging/examples
```

Expected: all tests pass and every file is formatted.

- [ ] **Step 7: Commit**

```bash
git add scripts/staging/release-evidence.ts scripts/staging/release-evidence.schema.json scripts/staging/release-evidence.unit.test.ts scripts/staging/examples
git commit -m "feat: bind evidence to founder release profiles"
```

### Task 3: Profile-aware smoke gate

**Files:**

- Modify: `scripts/staging/founder-release-smoke.ts`
- Modify: `scripts/staging/founder-release-smoke.unit.test.ts`

**Interfaces:**

- Consumes:
  - `releaseProfileDefinition`
  - `classifyEvidenceBundle`
  - schema-version-2 evidence types
- Produces:
  - `FounderStagingIdentity.releaseProfile`
  - profile-derived `FounderReleaseSmokeReport.classification`
  - phase results that never convert missing runners into configuration blockers

- [ ] **Step 1: Write failing smoke-gate tests**

Cover:

```ts
it.each([
  ["founder_core", undefined, true],
  ["founder_browser_experimental", IMMUTABLE_OPENCLAW, true],
  ["founder_core", IMMUTABLE_OPENCLAW, false],
  ["founder_browser_experimental", undefined, false]
])("validates %s OpenClaw binding", ...);
```

Also prove missing runner is `failed_assertion`, a blocked state is accepted only from validated
private evidence with remediation, passing core phases produce the two allowed founder-only
classifications, and browser experimental remains `no_go`.

- [ ] **Step 2: Run the focused smoke test and verify failure**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/founder-release-smoke.unit.test.ts
```

Expected: fail because the current gate has no profile or final classification.

- [ ] **Step 3: Implement profile parsing and phase selection**

Require `VERA_RELEASE_PROFILE`, derive capabilities and phases from the registry, forbid an OpenClaw
candidate for core, and require one for browser experimental. Bind manual evidence to the exact
identity including profile and capabilities.

- [ ] **Step 4: Implement fail-closed phase reporting**

Only execute runners for the selected profile. A missing runner produces `failed_assertion` with
`phase_runner_not_implemented`. A validated manual configuration blocker preserves its strict
metadata. Compute the report classification through the evidence classifier and never expose
credentials or private record contents.

- [ ] **Step 5: Run the smoke and evidence tests**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/founder-release-smoke.unit.test.ts scripts/staging/release-evidence.unit.test.ts scripts/staging/release-profiles.unit.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/staging/founder-release-smoke.ts scripts/staging/founder-release-smoke.unit.test.ts
git commit -m "feat: classify founder core staging evidence"
```

### Task 4: Browser activation fail-closed boundary

**Files:**

- Modify: `apps/web/lib/browser-agent-service.ts`
- Modify: `apps/web/lib/browser-agent-service.unit.test.ts`

**Interfaces:**

- Produces: `mutateBrowserControls` rejects any false-to-true enablement request while
  `systemBrowserDisabled` is true, before repository mutation.

- [ ] **Step 1: Add a failing unit test**

Invoke `mutateBrowserControls` with `systemBrowserDisabled: true` and each enablement field:

```ts
[
  { userBrowserEnabled: true },
  { zillowSourceEnabled: true },
  { nodeId: "founder-node", nodeEnabled: true },
  { nodeId: "founder-node", profileId: "vera-zillow", profileEnabled: true }
]
```

Expect `Browser controls cannot be enabled while the system browser kill switch is active.` and
prove no upsert or transaction function is called.

- [ ] **Step 2: Run the browser service test and verify failure**

Run:

```bash
./node_modules/.bin/vitest run --project unit apps/web/lib/browser-agent-service.unit.test.ts
```

Expected: at least one enablement mutation reaches the repository.

- [ ] **Step 3: Implement the pre-mutation guard**

Add a small predicate over `BrowserControlMutation`; when the global switch is active and any field
requests enablement, throw before reading or writing browser records. Disabling mutations remain
allowed.

- [ ] **Step 4: Run browser policy tests**

Run:

```bash
./node_modules/.bin/vitest run --project unit apps/web/lib/browser-agent-service.unit.test.ts apps/web/lib/server/hosted-runtime-policy.unit.test.ts apps/web/lib/server/maritime-dispatch.unit.test.ts
```

Expected: all browser boundary tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/browser-agent-service.ts apps/web/lib/browser-agent-service.unit.test.ts
git commit -m "fix: prevent latent browser activation"
```

### Task 5: Profile-bound immutable release manifest

**Files:**

- Modify: `infra/maritime/release-manifest.schema.json`
- Modify: `scripts/verify-release-manifest.ts`
- Modify: `scripts/verify-release-manifest.unit.test.ts`
- Modify: `scripts/verify-worker-release-promotion.unit.test.ts`

**Interfaces:**

- Consumes: `RELEASE_PROFILES`, `capabilitiesMatchProfile`
- Produces: release manifest schema version 2 with nullable OpenClaw artifacts only for core.

- [ ] **Step 1: Add failing manifest tests**

Create valid core and browser manifest factories. Prove:

- core requires exact core capabilities, `openclaw: null`, and
  `rollback.reviewedOpenclawImage: null`;
- browser experimental requires the pinned candidate and immutable reviewed rollback OpenClaw
  artifacts;
- mixed profile/capability combinations fail;
- mutable worker and OpenClaw references fail;
- candidate and rollback worker artifacts remain mandatory.

- [ ] **Step 2: Run manifest tests and verify failure**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/verify-release-manifest.unit.test.ts scripts/verify-worker-release-promotion.unit.test.ts
```

Expected: version-2 fields are rejected or absent.

- [ ] **Step 3: Implement validator and JSON Schema version 2**

Import the release-profile registry into the TypeScript validator. Validate a shared manifest
envelope first, then apply the exact core or browser branch. Keep the existing pinned OpenClaw
version and digest in the browser branch.

- [ ] **Step 4: Run manifest and workflow validators**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/verify-release-manifest.unit.test.ts scripts/verify-worker-release-promotion.unit.test.ts scripts/verify-worker-release-workflow.unit.test.ts
./node_modules/.bin/tsx scripts/verify-worker-release-workflow.ts
```

Expected: all tests pass and the workflow remains dispatch-only.

- [ ] **Step 5: Commit**

```bash
git add infra/maritime/release-manifest.schema.json scripts/verify-release-manifest.ts scripts/verify-release-manifest.unit.test.ts scripts/verify-worker-release-promotion.unit.test.ts
git commit -m "feat: bind release manifests to capabilities"
```

### Task 6: Founder-core runbook and documentation gate

**Files:**

- Create: `docs/FOUNDER_CORE_STAGING_RUNBOOK.md`
- Modify: `docs/RELEASE_READINESS.md`
- Modify: `docs/FOUNDER_STAGING_EVIDENCE.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `docs/DECISIONS/0012-founder-staging-openclaw-ingress.md`
- Modify: `infra/maritime/README.md`
- Modify: `infra/maritime/ENVIRONMENT.md`
- Modify: `infra/maritime/TOPOLOGY.md`
- Modify: `infra/maritime/COSTS.md`
- Modify: `scripts/verify-release-documentation.ts`
- Modify: `scripts/verify-release-documentation.unit.test.ts`

**Interfaces:**

- Produces: one operator sequence and static assertions that preserve profile separation and
  dispatch-only artifact generation.

- [ ] **Step 1: Add failing documentation validator tests**

Require the runbook to contain:

```ts
[
  "founder_core",
  "VERA_BROWSER_DISABLED=1",
  "release-evidence/private/",
  "chmod 0700",
  "chmod 0600",
  "gh workflow run release-worker.yml",
  "conditional_go_founder_only_staging",
  "go_founder_only_core_beta",
  "https://vera-ai-housing.vercel.app"
]
```

Also reject text that treats the landing page as hosted application staging evidence, permits a
public OpenClaw gateway, or claims the unresolved ingress decision blocks core.

- [ ] **Step 2: Run the documentation test and verify failure**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/verify-release-documentation.unit.test.ts
```

Expected: fail because the founder-core runbook is absent.

- [ ] **Step 3: Write the exact operator runbook**

Document:

1. merged-commit and CI preflight;
2. exact rollback and candidate workflow-dispatch commands without executing them;
3. PostgreSQL snapshot, logical backup, restore rehearsal, migration, and idempotent bootstrap;
4. hosted application deployment while preserving the existing marketing landing page;
5. private worker deployment by immutable digest;
6. one-at-a-time direct capture, worker replay/restart, Web Push, Gmail read-only, and Calendar
   enablement;
7. browser-disabled enforcement checks with no gateway or public endpoint;
8. emergency disable and rollback;
9. external private evidence bundle generation, hashing/signing, private artifact copy,
   retention, and deletion.

- [ ] **Step 4: Reconcile the existing readiness, security, ADR, and Maritime documents**

State that ADR 0012 blocks only browser experimental. Preserve the full browser-live gate. Remove
any statement that core requires an OpenClaw image or gateway. State that the landing page is already
deployed marketing and is outside the core staging application evidence.

- [ ] **Step 5: Run documentation and Maritime validation**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/verify-release-documentation.unit.test.ts
./node_modules/.bin/tsx scripts/verify-release-documentation.ts
node infra/maritime/validate.mjs
```

Expected: all documentation boundaries pass.

- [ ] **Step 6: Commit**

```bash
git add docs/FOUNDER_CORE_STAGING_RUNBOOK.md docs/RELEASE_READINESS.md docs/FOUNDER_STAGING_EVIDENCE.md docs/SECURITY_REVIEW.md docs/DECISIONS/0012-founder-staging-openclaw-ingress.md infra/maritime/README.md infra/maritime/ENVIRONMENT.md infra/maritime/TOPOLOGY.md infra/maritime/COSTS.md scripts/verify-release-documentation.ts scripts/verify-release-documentation.unit.test.ts
git commit -m "docs: add founder core staging runbook"
```

### Task 7: Full local release-gate validation

**Files:**

- Review all files changed by Tasks 1 through 6.

**Interfaces:**

- Produces: evidence-backed final local classification and a clean, reviewable branch without remote
  actions.

- [ ] **Step 1: Format changed files**

Run:

```bash
./node_modules/.bin/prettier --write scripts/staging scripts/verify-release-manifest.ts scripts/verify-release-manifest.unit.test.ts scripts/verify-worker-release-promotion.unit.test.ts scripts/verify-release-documentation.ts scripts/verify-release-documentation.unit.test.ts apps/web/lib/browser-agent-service.ts apps/web/lib/browser-agent-service.unit.test.ts infra/maritime/release-manifest.schema.json docs/FOUNDER_CORE_STAGING_RUNBOOK.md docs/RELEASE_READINESS.md docs/FOUNDER_STAGING_EVIDENCE.md docs/SECURITY_REVIEW.md docs/DECISIONS/0012-founder-staging-openclaw-ingress.md infra/maritime/README.md infra/maritime/ENVIRONMENT.md infra/maritime/TOPOLOGY.md infra/maritime/COSTS.md
```

Expected: formatting completes without changing unrelated files.

- [ ] **Step 2: Run focused unit tests and validators**

Run:

```bash
./node_modules/.bin/vitest run --project unit scripts/staging/release-profiles.unit.test.ts scripts/staging/release-evidence.unit.test.ts scripts/staging/founder-release-smoke.unit.test.ts apps/web/lib/browser-agent-service.unit.test.ts apps/web/lib/server/hosted-runtime-policy.unit.test.ts apps/web/lib/server/maritime-dispatch.unit.test.ts scripts/verify-release-manifest.unit.test.ts scripts/verify-worker-release-promotion.unit.test.ts scripts/verify-worker-release-workflow.unit.test.ts scripts/verify-release-documentation.unit.test.ts
./node_modules/.bin/tsx scripts/verify-release-documentation.ts
./node_modules/.bin/tsx scripts/verify-worker-release-workflow.ts
node infra/maritime/validate.mjs
```

Expected: tests and static validators pass. A production evidence invocation against a committed
synthetic example still fails.

- [ ] **Step 3: Run repository validation**

Run:

```bash
./node_modules/.bin/prettier --check .
./node_modules/.bin/eslint . --max-warnings=0
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/vitest run --project unit
./node_modules/.bin/vitest run --project integration
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test ./node_modules/.bin/vitest run --project postgres-integration
./node_modules/.bin/playwright test
./node_modules/.bin/pnpm -r --if-present run build
```

Expected: formatting, lint, typecheck, unit, integration, PostgreSQL integration, end-to-end, and
production builds pass.

- [ ] **Step 4: Review the diff**

Run:

```bash
git diff --check
git diff --stat main...HEAD
git diff main...HEAD -- . ':!pnpm-lock.yaml'
git status --short
```

Confirm no secret values, real evidence, deployment action, workflow dispatch, OpenClaw activation,
public ingress, mutable image reference, or unrelated product change is present.

- [ ] **Step 5: Commit any final validation-only correction**

If formatting or a validator requires a correction, stage only the affected files and use:

```bash
git commit -m "test: complete founder core release validation"
```

Otherwise leave the previously committed implementation unchanged.
