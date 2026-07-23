# Vera Founder Release Readiness

Date: 2026-07-22

Current decision: **conditional founder staging**. Local application, PostgreSQL, policy, build,
image, offline staging gates, and read-only Maritime inventory pass. Promotion is not approved
until immutable registry release evidence and the live gateway/worker staging matrix are complete.

## Verified locally

- Node 24 workspace formatting, lint, 12 TypeScript projects, and all static safety verifiers pass.
- Unit: 133 files and 944 tests pass.
- Non-PostgreSQL integration: 34 files and 138 tests pass; one opt-in live test is skipped.
- PostgreSQL integration: 16 files and 64 tests pass against the local PostgreSQL test database.
- Worker and Next.js production builds pass.
- Playwright Chromium: six founder flows pass.
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
- `.github/workflows/release-worker.yml` is a manual-only artifact release gate. It publishes a
  commit-tagged and digest-resolved GHCR worker, generates BuildKit and GitHub provenance plus SPDX
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

## Promotion blockers

1. Merge the reviewed manual release workflow to the default branch, dispatch it for the exact
   release ref, retain its sanitized evidence artifact, and select a separately reviewed distinct
   rollback worker digest. A passing workflow supplies the active registry digest, signature,
   provenance, worker SBOM, and zero-exception critical/high review; it does not deploy anything.
2. Create one deploy-scoped Maritime API key in protected operator storage. Read-only inventory
   found no existing long-lived key. Never paste its raw value into Codex, Git, or logs.
3. Obtain explicit approval to adopt the trigger-free existing OpenClaw agent, upgrade it from
   `2026.5.22` to Vera's reviewed `2026.6.33` digest, install the reviewed non-executable gateway
   config, and remove unneeded model-provider configuration. The separate Telegram-enabled agent
   must remain untouched.
4. Deploy one separate Vera worker agent by immutable digest. The read-only inventory found no
   existing Vera worker deployment.
5. Verify the adopted gateway's effective config, command surface, protected WSS route, explicit
   node/profile pairing, version compatibility, and local privacy boundary.
6. Run the unified live staging matrix, including node-offline, blocker/manual-action, replay,
   kill-switch, provider failure, notification idempotency, and rollback recovery paths.
7. Obtain explicit operator approval before every Maritime create, deploy, start, restart, stop,
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
Before any Maritime mutation, land the artifact workflow on the default branch and dispatch it for
an exact reviewed ref:

```bash
pnpm verify:worker-release-workflow
gh workflow run release-worker.yml --ref <reviewed-release-branch-or-tag>
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
or OpenClaw evidence requirements. The existing trigger-free agent is adopted and reconciled only
after an exact live diff and separate operator approval; Vera must not create a duplicate gateway.

## Evidence caveats

- The local Docker image ID is not a registry deployment digest.
- The private local SBOM is not signed release provenance.
- Read-only Maritime state has been observed, but the sleeping gateway's effective OpenClaw config,
  node pairing, and runtime command surface have not.
- OpenClaw's native `browser.proxy` remains broader than Vera's two fixed GET requests. It is
  acceptable only for the guarded single-founder experiment, not a public multi-user beta.
- Dependency advisory submission remains unperformed because it would disclose the frozen
  dependency inventory to a third-party advisory service and requires explicit user approval.
