# Maritime founder-release runbook

Status: operator-controlled; no automatic deployment

Maritime is Vera's primary production execution and scheduling plane. PostgreSQL remains canonical for users, policy, jobs, dispatch attempts, schedules, results, notification deliveries, and audit events. Maritime receives only an agent identifier when Vera wakes the worker; the worker claims accepted work from PostgreSQL.

## Supported versions

- Maritime CLI: `maritime-cli@1.7.0` (verified against npm and the current machine-readable CLI
  contract on 2026-07-22).
- Maritime application SDK: `maritime-sdk@0.5.0`, server-side only.
- OpenClaw gateway and node: `2026.6.33`.
- Vera worker base: Node `24.13.0` and pnpm `11.14.0`.

Run all commands from the repository root. Do not place a Maritime token on a command line, in shell history, or in this repository.

## Existing-deployment inventory — completed 2026-07-22

The founder account already has Maritime with OpenClaw. Do not create or deploy another agent as a
preflight step. Authenticate the operator CLI locally, then perform read-only discovery:

```sh
npm install --global maritime-cli@1.7.0
maritime login
maritime --version
maritime whoami --json
maritime guide --json
maritime list --json
```

Select the existing OpenClaw agent by returned ID and observed metadata; never guess its name.
Inspect that exact agent and any existing Vera worker without waking either one:

```sh
maritime info <existing-openclaw-agent> --json
maritime status <existing-openclaw-agent> --json
maritime history <existing-openclaw-agent> --json
maritime triggers list <existing-openclaw-agent> --json
maritime env list <existing-openclaw-agent> --json
```

Before using `env list`, confirm the installed CLI masks values. Abort evidence collection if a
secret value is printed. Do not collect raw logs during initial inventory. Raw JSON, if needed,
belongs only in permission-restricted `release-evidence/private/`, which is Git-ignored. A shareable
summary may retain statuses, variable names, trigger cadence, exposure, observed versions/digests,
and hashes of agent IDs—never secret values or raw page content.

Inventory is read-only. Do not run `create`, `deploy`, `start`, `restart`, `stop`, `sleep`, `delete`,
environment mutations, trigger mutations, file uploads, pairing approvals, PostgreSQL migrations,
or Vera dispatch during this phase.

The read-only inventory found two sleeping generic OpenClaw agents. Adopt only the trigger-free
candidate recorded in the private release evidence; the other agent has an enabled Telegram
trigger/channel and is outside Vera's scope. The candidate runs OpenClaw `2026.5.22`, below both
Maritime's currently documented `2026.5.28` template and Vera's reviewed `2026.6.33` runtime. No
existing Vera worker deployment was found. No agent was woken or mutated during inventory.

## Local release preflight

```sh
pnpm maritime:validate
pnpm verify:openclaw-config
pnpm verify:worker-release-workflow
```

The local Docker build is acceptance evidence only; it is not a deployable registry identity. The
registry release is intentionally separate from Maritime and must be run through
`.github/workflows/release-worker.yml`. That workflow runs only from the trusted default branch,
accepts an optional full source SHA that must be an ancestor of the default branch in
`zukhriddingit/VeraAI`, uses that selected commit as its sole tag, re-runs the full acceptance gate, resolves the registry digest, generates and
verifies provenance/signature/SBOM evidence, and fails on missing package coverage, a stale scanner
database, or any critical or high Trivy finding. Acceptance, build/scan, and sign/attest use
separate least-privilege jobs. Repository-controlled Trivy config and suppressions are not loaded,
and the closed action allowlist permits no Maritime credential or runtime command.

After the workflow has been reviewed and merged to the default branch, dispatch it from that branch
with an exact reviewed source SHA and retain the resulting evidence artifact:

```sh
gh workflow run release-worker.yml --ref main -f source_sha=<full-reviewed-source-sha>
gh run list --workflow release-worker.yml --limit 1
gh run watch <run-id> --exit-status
gh run download <run-id> --name vera-worker-release-<full-release-commit>
```

`workflow_dispatch` is unavailable until the workflow file exists on the default branch. A passing
artifact run does not deploy or approve deployment. Downloaded JSON and hashes are not trusted by
themselves. Before constructing or accepting the final release manifest, cryptographically
reverify the worker digest against the expected workflow identity and source commit:

```sh
pnpm verify:worker-release-promotion -- \
  --manifest release-evidence/private/founder-release-manifest.json \
  --evidence-dir release-evidence/worker \
  --confirm 'ghcr.io/<owner>/vera-worker@sha256:<reviewed-digest>'
```

This read-only command invokes `cosign verify` and verifies both retained GitHub provenance and SBOM
bundles. It also checks the downloaded SBOM bytes, requires that SPDX document to equal the
cryptographically verified predicate, pins the signer to `zukhriddingit/VeraAI`, and binds the
manifest source commit, exact workflow identity, and registry owner. Install the pinned Cosign
`v3.0.6`, authenticate `gh` for the repository, and run this command in the same operator session
immediately before promotion. A stored success message or artifact hash is not a substitute for
rerunning it. Do not use a mutable tag, and do not proceed without a reviewed schema-compatible
rollback worker digest plus the complete release manifest.

### First release and rollback evidence

Before any deployment, build and verify two independent worker artifacts. This is evidence collection
only; it does not authorize a Maritime mutation.

1. Identify the previous trusted default-branch commit and dispatch the workflow with its full SHA.
   Verify its registry digest, signature, provenance, SBOM, and vulnerability report; record that
   digest as `rollback.reviewedWorkerImage` in the private release manifest.
2. Dispatch the same default-branch workflow with the merged candidate's full SHA and independently
   verify its evidence. Record its digest as `worker.image`.
3. Record the reviewed candidate OpenClaw image and reviewed rollback OpenClaw image under
   `openclaw.image` and `rollback.reviewedOpenclawImage`. The same reviewed digest is allowed when
   no OpenClaw image or configuration change is proposed.
4. Set `rollback.workerSchemaCompatible` only after the earlier worker was tested against the migrated
   schema and record a hash of that test evidence. If compatibility fails or is unknown, image rollback
   is unavailable; use the managed PostgreSQL restore procedure instead.

Keep the complete evidence bundle under `release-evidence/private/` with directory mode `0700` and
file mode `0600`, then copy it to a restricted private artifact store before deleting the local copy.
See [`FOUNDER_STAGING_EVIDENCE.md`](../../docs/FOUNDER_STAGING_EVIDENCE.md).

Apply and verify PostgreSQL before starting a new worker image:

```sh
DATABASE_URL='<managed-postgresql-url>' pnpm db:migrate
DATABASE_URL='<managed-postgresql-url>' pnpm db:seed
```

## New provisioning — not the current founder path

Use new provisioning only when inventory proves no suitable agent exists and the operator has
approved an exact mutation plan. Confirm syntax with the installed `maritime guide --json`; the
repository does not treat old CLI examples as authority. The Vera worker does not require public
application ingress. Browser capture is currently blocked in Maritime staging; do not create or
expose an OpenClaw gateway until a reviewed TLS/WSS ingress decision replaces ADR 0012.

```sh
maritime create <vera-worker-options-confirmed-by-current-guide>
maritime create <openclaw-gateway-options-confirmed-by-current-guide>
```

The worker image contains `/health`, `/ready`, and `/metrics` on its agent-local port but no job
invocation endpoint. Use a TLS `wss` gateway URL and token authentication. Maritime agents may
still have secret invoke webhooks even without a public application URL; do not describe that as
"no public ingress." Do not assume private container networking.

Set environment names from [ENVIRONMENT.md](ENVIRONMENT.md) using Maritime's encrypted-secret dashboard or an access-controlled local file:

```sh
maritime env import vera-worker /secure/path/vera-worker.env --reload
maritime env import vera-openclaw-gateway /secure/path/openclaw-gateway.env --reload
maritime env list vera-worker
maritime env list vera-openclaw-gateway
```

The files under `/secure/path` must be outside the repository, permission-restricted, and deleted from transient operator hosts after import. Maritime marks imported values secret by default.

## Operator-controlled deploy or reconciliation

The deployment examples below are permitted only after the promotion verifier above and
`VERA_RELEASE_MANIFEST_PATH=... pnpm maritime:validate` both succeed for the same worker digest.
Neither validation command mutates Maritime.

The reviewed gateway config upload uses Maritime's supported custom-files endpoint. It is fixed to
`https://api.maritime.sh/api/v1/agents/{uuid}/files`, writes exactly one non-executable
`/data/.openclaw/openclaw.json`, and never reads the interactive CLI login. Supply a separate
deploy-scoped key through the operator's protected environment. A default or mismatched invocation
fails before making a network request:

```sh
pnpm maritime:upload-openclaw-config -- --confirm '<exact-inventoried-candidate-uuid>'
```

`VERA_MARITIME_GATEWAY_AGENT_ID` and `MARITIME_API_KEY` must already be present in the protected
operator environment. Do not put either value on the command line or in shell history.

The command emits only a correlation ID, a one-way agent-ID hash, and the uploaded config hash.
It never prints the agent ID, API key, config content, or provider response. This remains a
mutation and requires explicit operator approval immediately before use.

```sh
maritime deploy vera-worker --source docker --image ghcr.io/<owner>/vera-worker@sha256:<candidate-worker-digest> --wait
maritime deploy <existing-openclaw-agent> --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
maritime status vera-worker
maritime status <existing-openclaw-agent>
```

These are mutation examples, not authorization to run them. For the existing founder deployment,
first compare observed image/version, config, exposure, trigger state, and rollback history to the
reviewed desired state. Present the exact diff and obtain operator approval before deploy or config
upload. Record selected IDs in server-side environment configuration; IDs are not authorization
tokens and are never client-exposed.

## Trigger configuration

Maritime CLI 1.7.0 supports operator-controlled cron creation through `triggers create`; the
dashboard remains an equivalent reviewed operator path. Do not create the trigger until the worker
digest is deployed and the operator has approved the exact mutation.

1. Confirm the exact worker ID and immutable deployed digest.
2. Add one UTC cron trigger every five minutes in the dashboard or with the exact CLI 1.7.0 command:

```sh
maritime triggers create <vera-worker> --type cron --cron '*/5 * * * *' --json
```

3. Keep browser acquisition scheduling disabled. The trigger wakes the worker; PostgreSQL
   schedules decide which approved tenant work is due.
4. Validate:

```sh
maritime triggers list vera-worker --json
maritime logs vera-worker --level error -n 50
```

Gmail alert ingestion, notification fan-out, normalization/decision reconciliation, stale checks, health reconciliation, and cleanup are eligible schedule kinds. Each run rechecks current policy and its kill switches. Zillow current-tab capture remains user-triggered only.

## Release validation

```sh
pnpm maritime:validate
maritime status vera-worker
maritime status <existing-openclaw-agent> --json
maritime triggers list vera-worker --json
```

The worker is private, so there is intentionally no public `/health` or `/ready` URL to curl.
Confirm its agent-local health/readiness through the current supported Maritime status evidence and
the operator-only Vera operations view. If the current CLI/API cannot expose that evidence, record
the check as unavailable rather than making the worker public.

Then use the operator-only Vera view at `/settings/operations` to confirm deployment, gateway, node heartbeat, trigger, durable job, kill-switch, and notification state. Never paste raw Maritime or OpenClaw logs into Vera.

## Rollback

Inspect history before selecting an immutable prior worker image:

```sh
maritime history vera-worker -n 10
maritime deploy vera-worker --source docker --image ghcr.io/<owner>/vera-worker@sha256:<reviewed-rollback-worker-digest> --wait
maritime status vera-worker
```

For a failed OpenClaw configuration change, redeploy the reviewed pin and restart:

```sh
maritime deploy <existing-openclaw-agent> --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
maritime restart <existing-openclaw-agent>
maritime status <existing-openclaw-agent> --json
```

Do not roll back to Maritime's currently documented `2026.5.28` template image; it is outside Vera's reviewed security floor. For database rollback, use the managed snapshot procedure in `docs/POSTGRES_OPERATIONS.md`, never SQLite.

## Stop without deleting

```sh
maritime stop vera-worker
maritime stop <existing-openclaw-agent>
```

Deletion is intentionally not part of this runbook. It requires a separate reviewed change because it can destroy operational state.
