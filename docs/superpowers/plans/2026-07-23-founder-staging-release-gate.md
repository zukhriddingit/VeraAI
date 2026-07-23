# Founder Staging Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a fail-closed, evidence-backed release gate that can support conditional founder-only staging without deployment.

**Architecture:** A small TypeScript evidence library validates closed record and bundle schemas, canonicalizes/hash-binds accepted private evidence, and feeds a phase-complete staging harness. Static release workflow/documentation validators keep artifact creation commit-bound and deployment-free. An ADR deliberately blocks browser ingress until a supported topology exists.

**Tech Stack:** Node.js 24, TypeScript strict mode, Vitest, GitHub Actions YAML, JSON Schema, SHA-256 from `node:crypto`.

## Global Constraints

- Real evidence lives only in gitignored `release-evidence/private/` with mode `0700`; evidence files require mode `0600`.
- Mandatory phases pass only with `passed_automated` or `passed_manual_evidence`.
- No deploy, Maritime mutation, workflow dispatch, browser scheduling, Gmail draft creation, or send capability.
- Production examples and release manifests use digest-qualified OCI image references only.
- Browser capture remains blocked in Maritime staging until a documented reviewed ingress topology exists.

---

### Task 1: Create evidence primitives and fixtures

**Files:**

- Create: `scripts/staging/release-evidence.ts`
- Create: `scripts/staging/release-evidence.unit.test.ts`
- Create: `scripts/staging/examples/synthetic-manual-evidence.json`
- Create: `scripts/staging/examples/synthetic-evidence-bundle.json`
- Create: `scripts/staging/release-evidence.schema.json`
- Modify: `.gitignore`

**Produces:** closed record/bundle validators, deterministic canonical hashing, private-directory enforcement, and synthetic fixtures rejected by production mode.

- [ ] Write tests for closed fields, secret-like content, hashes, phase matching, mixed bindings, deterministic bundle hashes, private path/modes, and synthetic fixture rejection.
- [ ] Run the focused tests and confirm they fail because the evidence module does not exist.
- [ ] Implement the schema and pure TypeScript module with SHA-256 hashing and allowed result states.
- [ ] Implement private evidence loading that refuses paths outside `release-evidence/private/`, symlinks, and broad file modes.
- [ ] Add synthetic fixtures marked `synthetic: true` and reject them unless `VERA_RELEASE_GATE_TEST_ONLY=1`.
- [ ] Re-run the focused tests and commit the isolated evidence boundary.

### Task 2: Replace the placeholder staging harness

**Files:**

- Modify: `scripts/staging/founder-release-smoke.ts`
- Modify: `scripts/staging/founder-release-smoke.unit.test.ts`
- Create: `scripts/staging/founder-release-gate.ts`
- Create: `scripts/staging/founder-release-gate.unit.test.ts`
- Modify: `package.json`

**Consumes:** `validateEvidenceBundle`, `loadPrivateEvidenceBundle`, `FOUNDER_STAGING_PHASES`.

**Produces:** one required runner/evidence validator per named phase and a non-zero gate result for any blocked/missing phase.

- [ ] Replace the legacy status model and phase list with the 20 approved identifiers.
- [ ] Write tests that assert each phase has a runner or evidence validator, missing configuration blocks, and no mandatory phase silently skips.
- [ ] Make gateway negative checks automated and classify unavailable configuration/provider outcomes safely.
- [ ] Require valid private manual evidence for non-automatable operations and restrict a record to its named phase.
- [ ] Emit a sanitized decision summary and no raw evidence.
- [ ] Run the focused harness/evidence tests.

### Task 3: Make artifact creation select a trusted source commit

**Files:**

- Modify: `.github/workflows/release-worker.yml`
- Modify: `scripts/verify-worker-release-workflow.ts`
- Modify: `scripts/verify-worker-release-workflow.unit.test.ts`
- Modify: `infra/maritime/release-manifest.schema.json`
- Modify: `scripts/verify-release-manifest.ts`
- Modify: `scripts/verify-release-manifest.unit.test.ts`

**Consumes:** full `source_sha` workflow input and digest-only candidate/rollback identities.

**Produces:** workflow and manifest validators that allow only a main-ancestor source SHA and complete candidate/rollback identities.

- [ ] Add a test for workflow dispatch only, default-branch workflow execution, invalid SHA rejection, arbitrary/non-main ancestor rejection, and lifecycle-operation rejection.
- [ ] Add an optional full SHA input, validate it against the trusted checked-out repository, and fetch/check out only that object for building.
- [ ] Preserve immutable image digest, SBOM, scan, provenance, signature, and verification artifacts without deployment.
- [ ] Extend the manifest with candidate and reviewed rollback identities and reject mutable image strings.
- [ ] Run workflow/manifest tests and static validators.

### Task 4: Harden documentation and record the ingress decision

**Files:**

- Create: `docs/DECISIONS/0012-founder-staging-openclaw-ingress.md`
- Modify: `docs/RELEASE_READINESS.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `docs/GOOGLE_INTEGRATION_SETUP.md`
- Modify: `docs/POSTGRES_OPERATIONS.md`
- Modify: `infra/maritime/README.md`
- Modify: `infra/maritime/OPENCLAW.md`
- Create: `docs/FOUNDER_STAGING_EVIDENCE.md`
- Create: `scripts/verify-release-documentation.ts`
- Create: `scripts/verify-release-documentation.unit.test.ts`
- Modify: `package.json`

**Produces:** digest-only operational examples, Google/rollback evidence procedures, retention instructions, an explicit browser block, and a static documentation gate.

- [ ] Define manual evidence collection/redaction/approval/retention procedures and external-artifact copying steps.
- [ ] Document Gmail readonly and Calendar free/busy/approved-hold evidence procedures without draft creation.
- [ ] Replace all staging/production deployment examples with clearly labelled `image@sha256:<digest>` placeholders.
- [ ] Write an ADR selecting option C and state gateway/node roles, WSS requirement, no approved exposure, failure/shutdown behavior, and multi-user prerequisites.
- [ ] Add a documentation validator and tests that fail mutable production references.
- [ ] Run documentation and Markdown-related static checks.

### Task 5: Verify and report the release classification

**Files:**

- Modify: relevant test files only for regressions discovered during validation.

- [ ] Run formatting, lint, typecheck, focused unit tests, static release validators, secret scan, and diff review.
- [ ] Run integration/PostgreSQL/E2E/build checks where the local toolchain permits; distinguish environment failures from product failures.
- [ ] Review the diff for secrets, accidental mutable references, release side effects, and untracked evidence.
- [ ] Report fixed findings, remaining live-evidence blockers, the complete phase matrix, rollout/rollback steps, and a `conditional go for founder-only staging` classification only if the local release gate is complete and the live gate remains explicitly pending.

