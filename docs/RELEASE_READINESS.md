# Vera Founder Release Readiness

## 2026-08-13 production application cutover

Current application decision: **no-go until cutover acceptance completes**. The approved target is
one Heroku Eco web process + one Eco deterministic worker + same-region Heroku Postgres Essential-0,
with marketing on Vercel and approved browser dispatch through Maritime to the unchanged signed
DigitalOcean Gateway. The approved recurring ceiling is $10 monthly with no automatic upgrade.
Eco cold starts and Essential-0's founder-MVP service limits are accepted; this is not a 24/7 or HA
claim. The historical founder-core/browser findings below remain evidence history rather than the
current application placement contract.

Production promotion requires all of these current, directly observed gates:

- a verified encrypted source backup and an exact source/destination safe-count manifest match;
- migrations current and the hosted seed idempotent;
- web and worker images built from and labeled with the same merged source SHA;
- one Heroku release containing both process types;
- exactly one Eco web and one Eco worker, with no uptime pinger and `VERA_DB_POOL_MAX=3`;
- exactly one Essential-0 database and no paid Heroku product beyond the $10 monthly ceiling;
- `/api/ready` returning ready ten consecutive times across at least five minutes;
- founder authentication, inbox, listing detail, source links, provenance, and activity history;
- one idempotent deterministic worker job without an external side effect;
- `verahousing.app` serving the Vercel marketing deployment, valid TLS, and `www` redirecting to the
  apex while `app.verahousing.app` remains the product;
- forbidden browser-action count zero and unpaired/unshared browser access still fail-closed;
- DigitalOcean source data, the Railway recovery volume, and the accepted OpenClaw Gateway retained
  unchanged.

A liveness response, static marketing page, cached count, or local tunnel is not production
acceptance. Use `infra/heroku/production-manifest.json` and `docs/POSTGRES_OPERATIONS.md` as the
current application cutover contract.

Date: 2026-07-27

Current decision: **no-go for founder staging release**. Local application, PostgreSQL, policy,
build, image, offline staging gates, and read-only Maritime inventory pass, but no private live
evidence bundle has completed a profile-specific mandatory release matrix. Promotion and founder
beta are not approved.

The release gate has two explicit profiles. `founder_core` keeps browser capture disabled while
direct capture, Gmail alerts, Calendar, Web Push, and the private Maritime worker remain in scope.
It replaces browser-positive checks with mandatory proof that browser controls, dispatch, ingress,
scheduling, and UI/API activation are disabled. ADR 0012 never blocks that profile when those
phases pass. ADR 0013 supersedes ADR 0012 for `founder_browser_experimental`, but the profile remains
`no_go` under `remote_extension_live_acceptance_pending` until every direct-WSS extension phase and
security audit has accepted private evidence.

R2 local transport testing found that the published R1 browser image accepts an unrelated
WebSocket path through OpenClaw's generic Gateway fallback. That digest is rejected. The focused
route-isolation and zero-finding replacement at immutable digest
`sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3`
exposes only an exact filter on port `18789`, moves the general Gateway to loopback port `18790`,
uses derived browser-control port `18792`, has zero Trivy `HIGH` or `CRITICAL` findings, and passes
signature, provenance, SBOM, and attestation verification. Its first disposable Maritime run
failed before entrypoint because the provider bootstrap expected `/usr/local/bin` to exist. The
bootstrap-compatible candidate was published from merged source
`69fee2fcedf7d0474d5a75d64323318b993f7a6a` as immutable digest
`sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4`. It adds only that
empty root-owned directory, keeps it outside PATH, passes an independent anonymous pull, layout
simulation, and zero-finding scan, but is not deployable: its push-only workflow inspected the
digest before pulling it into job-local Docker and therefore skipped GitHub attestation and Cosign
signing. This does not affect `founder_core`; it remains an artifact blocker for browser
experimental.

The approved recovery uses the exact existing digest, source commit, and publication run. It
performs no rebuild and no replacement publication. Before any registry write it downloads the
bound publication artifact, anonymously pulls the digest, verifies immutable labels and layout,
regenerates an SPDX SBOM, and runs an independent zero-finding scan with pinned Trivy. Only then may
it create GitHub provenance/SBOM attestations and a Cosign signature. The temporary
`GHCR_PUBLISH_TOKEN` must be deleted immediately after the recovery workflow reaches a terminal
state. Maritime remains out of scope until all recovered evidence verifies.

R3 distinguishes the signed release index identity from the pull-critical runtime child identity.
The first R3 release index was
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4`;
its only runnable `linux/amd64` runtime child is
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a`.
The index also contains one `unknown/unknown` BuildKit attestation descriptor. Both the previous
index and current index use an OCI index with one OCI gzip runtime, so index shape alone does not
prove a Maritime incompatibility. The non-publishing PR check verifies the top-level index, child
manifest, config, and every runtime layer from a GitHub-hosted runner. A deterministic binding
record separately binds the selected child, source revision, image config, rootfs diff IDs,
signature, provenance subject, and SBOM subject.

The browser profile remains `no_go` until the bounded Maritime A/B/C matrix and final Gateway
acceptance pass. The matrix uses one private trigger-free diagnostic agent for, in order, the
previous index, current index, and current child, with a fifteen-minute bound per case. A current
child that reaches `fc-manager` or runtime is selected without publishing another image. If all
three hang, the result is a provider/agent/registry incident. A compatibility publication is
permitted only after verified public blobs and a concrete direct-child media-type, compression, or
descriptor failure; otherwise it is unreachable.

Maritime subsequently proved that both that OCI index and its direct child pull and unpack
successfully. Both then failed before Vera's entrypoint because the hardened Chainguard filesystem
used merged-`/usr` symlinks while Maritime requested its provider-injected init at
`/sbin/maritime-init`. PR #17 restored a real empty root-owned `/usr/sbin` and
`/sbin -> usr/sbin` without embedding a provider helper or changing OpenClaw behavior. The current
replacement is release index
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec`,
with one runnable `linux/amd64` child
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8`,
from source `01bc0adc02808dbaf01089d1464ee8db5fe90593`. The index passes anonymous
pull, exact layout verification, Trivy zero-finding scans, Cosign verification, SLSA provenance,
and SPDX SBOM verification. The child remains non-deployable until the exact-child workflow binds
the same controls directly to it and live Maritime/WSS/Chrome acceptance passes.

For core, all passing phases produce `go_founder_only_core_beta`; passing phases plus only valid
external configuration blockers produce `conditional_go_founder_only_staging`. Any failure, N/A
mandatory phase, invalid/stale/mismatched evidence, missing phase, implementation gap, policy gap,
schema gap, test failure, unresolved security finding, or design decision produces `no_go`.

## Verified locally

- Node 24 workspace formatting, lint, 12 TypeScript projects, and all static safety verifiers pass.
- Unit: 137 files and 1,008 tests pass.
- Non-PostgreSQL integration: 35 files and 140 tests pass; one opt-in live test is skipped.
- PostgreSQL integration: 16 files and 65 tests pass against the local PostgreSQL test database.
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
safety verifiers, 12 TypeScript projects, 137 unit files with 1,008 tests, 35 non-PostgreSQL
integration files with 140 tests plus one opt-in live skip, 16 PostgreSQL integration files with 65
tests, six serial Playwright Chromium flows, and both worker and Next.js production builds. This
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
3. Select `founder_core`, keep browser capture disabled, and keep gateway adoption absent. Prove the
   seven mandatory browser-disabled phases. The direct remote-extension architecture is a separate
   `founder_browser_experimental` spike and cannot satisfy core. The Telegram-enabled agent remains
   outside Vera's scope.
4. If separately authorized after this gate, deploy one Vera worker only by candidate immutable
   digest. The read-only inventory found no existing Vera worker deployment.
5. Run the founder-core matrix in `FOUNDER_CORE_STAGING_RUNBOOK.md`, including dispatch, replay,
   restart, emergency disable, provider failure, notification idempotency, Gmail readonly, Calendar
   hold, PostgreSQL restore, worker rollback, and mandatory browser-disabled enforcement. Browser
   requirements are replaced by profile selection, never skipped or marked N/A.
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
or live Google/restore evidence requirements. Founder core requires no gateway. ADR 0013 selects a
dedicated per-user Gateway for the browser experiment, but creation and exposure remain blocked
until the public-proxy and security acceptance prerequisites authorize that separate work.

## Evidence caveats

- The local Docker image ID is not a registry deployment digest.
- The private local SBOM is not signed release provenance.
- The 2026-07-25 disposable Gateway probe reached the prefixed extension route over HTTPS but every
  WebSocket upgrade returned `403` before OpenClaw's expected no-token `401`; the valid official
  pairing secret did not produce `101` or a selected relay subprotocol. Maritime's current public
  proxy therefore fails the direct-extension transport gate. Payload limits, idle timeouts,
  stability, reconnect, pairing, and snapshot behavior remain unproven.
- OpenClaw `2026.7.1` provides the direct extension relay, but its 64 MiB relay-frame bound does not
  prove Maritime's proxy limits. Vera's dedicated plugin and hosted client impose much smaller
  bounds and still require live evidence.
- Dependency advisory submission remains unperformed because it would disclose the frozen
  dependency inventory to a third-party advisory service and requires explicit user approval.
### Founder live official-API demo does not enable browser release scope

The opt-in RentCast-to-Maritime OpenClaw chat path documented in
`docs/EOD_LIVE_AGENT_DEMO.md` is an `official_api` founder demonstration with browser execution
disabled. It does not deploy an OpenClaw browser gateway, satisfy browser-positive phases, widen
`founder_core`, or satisfy the remote-extension live acceptance gate. Real release evidence and every
mandatory founder-core phase remain required for a release classification.
