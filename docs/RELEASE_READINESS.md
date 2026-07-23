# Vera Founder Release Readiness

Date: 2026-07-23

Current decision: **no-go for founder staging release**. Local application, PostgreSQL, policy,
build, image, offline staging gates, and read-only Maritime inventory pass, but no private live
evidence bundle has completed the mandatory release matrix. Browser capture is explicitly blocked by
ADR 0012 until a reviewed ingress topology exists; a blocked mandatory phase cannot produce a
release pass. Promotion and founder beta are not approved.

## Verified locally

- Node 24 workspace formatting, lint, 12 TypeScript projects, and all static safety verifiers pass.
- Unit: 136 files and 958 tests pass.
- Non-PostgreSQL integration: 35 files and 140 tests pass; one opt-in live test is skipped.
- PostgreSQL integration: 16 files and 65 tests pass against the local PostgreSQL test database.
- Worker and Next.js production builds pass.
- Playwright Chromium: nine founder flows pass.
- Local worker image: `sha256:302db8495e14e039f061be9601a0fdbe0ac58189f650dae03514bf6b863c4a13`.
- Runtime identity: non-root UID/GID 10001; Node 24.13.0; OpenClaw 2026.6.33 (`7af0cfc`).
- Runtime production dependencies include `pg`, `sharp`, and `openclaw`; test tools and all
  `better-sqlite3` runtime artifacts are absent.
- Private local SPDX SBOM SHA-256:
  `24f143dce315b0efc5d394e27d6c433b895b09439e9f6615e9285c616dbaf037` (725 packages,
  2,760 files).
- Local Maritime asset validation passes and explicitly refuses to claim deploy readiness without
  live release evidence.
- The guarded OpenClaw config uploader validates both reviewed configs, requires an exact UUID
  confirmation and deploy-scoped `MARITIME_API_KEY`, targets only the canonical Maritime
  custom-files endpoint, uploads one non-executable file, bounds time and responses, and makes no
  request on its default path. Its focused verifier/uploader suite passes 32 tests.
- `.github/workflows/release-worker.yml` is a manual-only artifact release gate. Its workflow code
  runs only from the trusted default branch; an optional full source SHA must resolve in
  `zukhriddingit/VeraAI` and be an ancestor of that branch before it is built, commit-tagged, and
  digest-resolved. It generates BuildKit and GitHub provenance plus SPDX
  SBOM attestations, keylessly signs and verifies the digest, records Trivy database freshness, and
  fails on missing OS/Node package coverage or any critical or high finding. A read-only acceptance
  job must pass before the separately permissioned build/scan and sign/attest jobs. Trivy uses
  `/dev/null` for both config and ignore input, user-repository-incompatible storage records are
  disabled, and verification outputs/bundles are retained by hash. Every third-party action belongs
  to an exact count-checked allowlist and is pinned to a reviewed commit. Static tests reject
  automatic triggers, mutable references, repository secrets, and any Maritime or runtime
  lifecycle command. The verifier also parses each job boundary and enforces exact permissions and
  dependencies. Before promotion, `verify:worker-release-promotion` reruns Cosign and GitHub
  provenance/SBOM verification against the exact registry digest, source commit, and workflow
  identity pinned to `zukhriddingit/VeraAI`, verifies the retained signed bundles, and requires the
  downloaded SPDX document to equal the verified SBOM predicate instead of trusting downloaded
  hashes. The workflow has not been dispatched yet.

## Prompt 12 code review

The final `main...ddcbe3f` diff review found and locally fixed two code-level release blockers:

- hosted connector composition now excludes `fixture.feed.v1`, while the explicit deterministic
  demo composition retains it; new hosted PostgreSQL policy seeds also exclude fixture acquisition
  manifests;
- a Maritime-dispatched source job whose worker crashes after consuming the dispatch can be
  reclaimed after lease expiry by the same worker audience, without exceeding the attempt budget
  or permitting two replacement workers to claim it.

No schema migration was required. An older hosted database may retain a global fixture policy row;
the hosted connector registry cannot execute it, and the seed neither deletes nor rewrites existing
policy history. The complete post-remediation local gate passes: formatting, ESLint, all static
safety verifiers, 12 TypeScript projects, 136 unit files with 958 tests, 35 non-PostgreSQL
integration files with 140 tests plus one opt-in live skip, 16 PostgreSQL integration files with 65
tests, nine serial Playwright Chromium flows, and both worker and Next.js production builds. This
local result does not replace required private live release evidence.

Capability truth for this release:

- Gmail listing-alert ingestion is production code behind incremental `gmail.readonly`;
- Gmail draft creation is not implemented, and no Gmail send capability exists;
- Calendar free/busy and user-approved tentative holds are production code behind incremental
  scopes;
- Zillow current-tab capture is founder-only, experimental, disabled by default, and not approved
  for untrusted multi-user access;
- Maritime, OpenClaw, and Web Push live smoke evidence remains open.

## Promotion blockers

1. Dispatch the reviewed default-branch workflow twice with full trusted SHAs: once for the prior
   trusted worker baseline and once for the candidate. Retain and independently verify both sanitized
   artifacts, record candidate/rollback worker and OpenClaw digests, and fail image rollback when
   backward-schema compatibility lacks accepted evidence. The workflow never deploys anything.
2. Create one deploy-scoped Maritime API key in protected operator storage. Read-only inventory
   found no existing long-lived key. Never paste its raw value into Codex, Git, or logs.
3. Keep browser capture and gateway adoption disabled for Maritime staging under ADR 0012. Do not
   expose, pair, or upgrade an OpenClaw browser gateway until a documented ingress decision is
   reviewed. The Telegram-enabled agent remains outside Vera's scope.
4. If separately authorized after this gate, deploy one Vera worker only by candidate immutable
   digest. The read-only inventory found no existing Vera worker deployment.
5. Run the unified non-browser staging matrix, including dispatch, replay, kill-switch, provider
   failure, notification idempotency, Gmail readonly, Calendar hold, PostgreSQL restore, and worker
   rollback paths. Browser phases remain visibly blocked, not skipped.
6. Obtain explicit operator approval before every Maritime create, deploy, start, restart, stop,
   environment mutation, file upload, pairing, trigger mutation, or rollback action.

## Read-only Maritime inventory

Authentication and inventory completed on 2026-07-22 with Maritime CLI 1.7.0. Two sleeping generic
OpenClaw agents exist:

- The trigger-free agent is the proposed Vera gateway adoption target. It runs
  `ghcr.io/openclaw/openclaw:2026.5.22`, has no public web URL or exposed port, and has no trigger.
  Its effective config, node/profile pairing, and protected WSS route remain unverified.
- The other agent has an enabled Telegram trigger/channel and is excluded from Vera.

No existing Vera worker deployment was found. No agent was woken or mutated during inventory. Full
identifiers and sanitized evidence are stored only in the Git-ignored private release-evidence
directory.

## Authenticated release sequence

Install and authenticate the exact CLI locally:

```bash
npm install --global maritime-cli@1.7.0
maritime login
maritime whoami --json
```

Do not paste the Maritime token into chat. Authentication and read-only inventory are complete.
Before any Maritime mutation, land the artifact workflow on the default branch and dispatch it from
that branch for an exact reviewed source SHA:

```bash
pnpm verify:worker-release-workflow
gh workflow run release-worker.yml --ref main -f source_sha=<full-reviewed-source-sha>
gh run list --workflow release-worker.yml --limit 1
gh run watch <run-id> --exit-status
gh run download <run-id> --name vera-worker-release-<full-release-commit>
pnpm verify:worker-release-promotion -- \
  --manifest release-evidence/private/founder-release-manifest.json \
  --evidence-dir release-evidence/worker \
  --confirm 'ghcr.io/<owner>/vera-worker@sha256:<reviewed-digest>'
```

GitHub accepts `workflow_dispatch` only after the workflow exists on the default branch. The
downloaded evidence is not a deployment authorization and does not satisfy the separate rollback
or live Google/restore evidence requirements. Browser gateway adoption remains blocked by ADR 0012;
Vera must not create a duplicate gateway.

## Evidence caveats

- The local Docker image ID is not a registry deployment digest.
- The private local SBOM is not signed release provenance.
- Read-only Maritime state has been observed, but the sleeping gateway's effective OpenClaw config,
  node pairing, and runtime command surface have not.
- OpenClaw's native `browser.proxy` remains broader than Vera's two fixed GET requests. It is
  acceptable only for the guarded single-founder experiment, not a public multi-user beta.
- Dependency advisory submission remains unperformed because it would disclose the frozen
  dependency inventory to a third-party advisory service and requires explicit user approval.
