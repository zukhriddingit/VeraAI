# Founder-core staging runbook

Status: operator procedure; no command in this document is pre-authorized

Profile: `founder_core`

Current classification: `no_go` until a real, private, profile-bound evidence bundle is complete.

The existing [Vera landing page](https://vera-ai-housing.vercel.app) is already deployed marketing.
It is not the authenticated Vera application, is not founder-core staging evidence, and must not be
redeployed as part of this procedure.

## Non-negotiable boundary

The selected capability set is:

```json
{
  "browserCapture": false,
  "directCapture": true,
  "gmailAlerts": true,
  "calendar": true,
  "webPush": true,
  "maritimeWorker": true
}
```

Keep all capabilities disabled at the start. Set `VERA_BROWSER_DISABLED=1` for the entire release.
Do not set `VERA_MARITIME_GATEWAY_AGENT_ID`, `OPENCLAW_GATEWAY_URL`,
`OPENCLAW_GATEWAY_TOKEN`, or `VERA_BROWSER_FOUNDER_USER_IDS`. Do not deploy, adopt, start, expose,
pair, or schedule an OpenClaw gateway or browser node.

Start with:

```sh
VERA_BROWSER_DISABLED=1
VERA_GMAIL_ALERTS_DISABLED=1
VERA_INTEGRATIONS_DISABLED=1
VERA_NOTIFICATIONS_DISABLED=1
```

Change only one capability lane at a time, collect its evidence, and return it to disabled before
moving to the next lane when the runtime supports a separate kill switch. Browser capture never
changes from disabled.

## Release-profile phase matrix

| Capability | `founder_core` mandatory phases | `founder_browser_experimental` mandatory phases |
| --- | --- | --- |
| Release/static | `release_static_readiness`, `emergency_disable`, `worker_image_rollback` | same |
| PostgreSQL/web | `postgresql_snapshot_and_backup`, `postgresql_restore`, `migration_and_idempotent_bootstrap`, `hosted_web_deployment` | same |
| Maritime worker/direct capture | `maritime_worker_dispatch`, `direct_capture`, `duplicate_dispatch`, `replayed_result`, `worker_restart_recovery` | same |
| Web Push | `web_push_delivery`, `web_push_deduplication`, `quiet_hours`, `provider_outage` | same |
| Gmail/Calendar | `gmail_readonly_verification`, `calendar_freebusy_and_approved_hold` | same |
| Browser boundary | `browser_global_kill_switch_enabled`, `browser_founder_capability_disabled`, `browser_source_jobs_rejected_before_dispatch`, `browser_gateway_not_required`, `browser_endpoint_not_exposed`, `browser_monitoring_not_scheduled`, `browser_activation_not_exposed` | `gateway_unauthenticated_request`, `gateway_wrong_token`, `founder_positive_current_tab_capture`, `node_offline`, `stale_heartbeat`, `manual_login_2fa_captcha_blocker`, `kill_switch_after_queueing`, `worker_crash_after_browser_invocation`, `gateway_restart` |

The profile registry selects this matrix before evidence evaluation. N/A records never remove a
phase.

## 1. Merge and artifact preflight

Required before any staging mutation:

- the evidence-gate merge `a59d8a69158d9416795f2a3dfa282d37297f0cfb` is an ancestor of the
  candidate;
- the founder-core profile PR is merged to `main`;
- CI is green on the exact merged candidate;
- `.github/workflows/release-worker.yml` exists on the default branch;
- the chosen source SHA is exactly 40 lowercase hexadecimal characters and an ancestor of
  `origin/main`;
- both rollback and candidate worker artifacts will be retained;
- every image used below is digest-qualified; and
- workflow review confirms no Maritime, deployment, trigger, environment, pairing, or runtime
  mutation.

Read-only local preflight:

```sh
git fetch origin main
git rev-parse origin/main
git merge-base --is-ancestor a59d8a69158d9416795f2a3dfa282d37297f0cfb origin/main
git show origin/main:.github/workflows/release-worker.yml
pnpm verify:worker-release-workflow
pnpm verify:release-documentation
```

Set the reviewed SHAs without printing secrets:

```sh
export ROLLBACK_SHA='<40-character-reviewed-prior-trusted-main-sha>'
export CANDIDATE_SHA="$(git rev-parse origin/main)"
test "$(printf '%s' "$ROLLBACK_SHA" | wc -c | tr -d ' ')" = 40
test "$(printf '%s' "$CANDIDATE_SHA" | wc -c | tr -d ' ')" = 40
git merge-base --is-ancestor "$ROLLBACK_SHA" origin/main
git merge-base --is-ancestor "$CANDIDATE_SHA" origin/main
```

Exact rollback artifact commands — record them in the operator change, but do not run them without
separate remote-action approval:

```sh
gh workflow run release-worker.yml --ref main -f source_sha="$ROLLBACK_SHA"
gh run list --workflow release-worker.yml --branch main --event workflow_dispatch --limit 5
gh run watch '<rollback-run-id>' --exit-status
gh run download '<rollback-run-id>' --name "vera-worker-release-$ROLLBACK_SHA" --dir release-evidence/private/rollback-worker
```

Exact candidate artifact commands — likewise not pre-authorized:

```sh
gh workflow run release-worker.yml --ref main -f source_sha="$CANDIDATE_SHA"
gh run list --workflow release-worker.yml --branch main --event workflow_dispatch --limit 5
gh run watch '<candidate-run-id>' --exit-status
gh run download '<candidate-run-id>' --name "vera-worker-release-$CANDIDATE_SHA" --dir release-evidence/private/candidate-worker
```

Resolve and record the two immutable worker references from their retained release evidence. Reject
`latest`, a branch, a commit-only tag, a local Docker image ID, or an unverified registry digest.

## 2. Private evidence workspace

Real records never enter Git:

```sh
mkdir -p release-evidence/private
chmod 0700 release-evidence/private
umask 077
```

After approved operator tooling writes an evidence file:

```sh
chmod 0600 release-evidence/private/founder-core-bundle.json
```

Evidence files contain references and hashes, not raw database backups, raw emails, screenshots,
browser profiles, environment files, identifiers, credentials, or provider payloads.

## 3. PostgreSQL snapshot and logical backup

- Verify the managed provider's point-in-time recovery window.
- Create a named managed snapshot and record only its opaque reference hash.
- Store the logical backup outside Git in a restricted backup location, never inside the evidence
  record.
- Hash the backup locally and record only the checksum plus a private-object locator.

Operator command pattern:

```sh
pg_dump --format=custom --no-owner --no-privileges --file='<restricted-backup-path>/vera-pre-release.dump' "$DATABASE_URL"
sha256sum '<restricted-backup-path>/vera-pre-release.dump'
```

The `postgresql_snapshot_and_backup` phase may be a configuration blocker only while the external
snapshot or operator execution is missing. Missing backup code, failed tests, or an unresolved
retention decision is `no_go`.

## 4. Restore rehearsal

- Restore into an isolated staging rehearsal database.
- Run integrity and tenant-boundary checks.
- Compare safe aggregate counts; do not attach row dumps.
- Destroy the rehearsal database under the provider's approved deletion process after retention
  requirements are satisfied.

```sh
createdb '<isolated-rehearsal-database>'
pg_restore --exit-on-error --no-owner --no-privileges --dbname='<isolated-rehearsal-database>' '<restricted-backup-path>/vera-pre-release.dump'
DATABASE_URL='<isolated-rehearsal-database-url>' pnpm db:migrate
DATABASE_URL='<isolated-rehearsal-database-url>' pnpm db:seed
DATABASE_URL='<isolated-rehearsal-database-url>' pnpm db:seed
```

The second seed must be idempotent. Record sanitized test-run references for
`postgresql_restore` and `migration_and_idempotent_bootstrap`.

## 5. Hosted application deployment

The authenticated application host must be selected and approved separately. The existing landing
page remains untouched.

Before deploying:

```sh
pnpm --filter @vera/web build
```

Deploy the exact merged candidate through the selected private staging project, record its immutable
deployment digest, and verify `/api/health` and `/api/ready`. A missing external staging project may
be `blocked_missing_configuration` with kind `external_deployment`; missing hosted composition or a
failing build is `no_go`.

Keep browser variables absent and `VERA_BROWSER_DISABLED=1`. Verify there is no OpenClaw WSS URL,
public browser endpoint, gateway agent, or browser schedule.

## 6. Private Maritime worker by digest

The worker needs only its worker agent ID and scoped API key in core. A gateway agent ID is forbidden.
After explicit mutation approval, the operator command is:

```sh
maritime deploy vera-worker --source docker --image 'ghcr.io/<owner>/vera-worker@sha256:<candidate-worker-digest>' --wait
maritime status vera-worker --json
```

Do not pass a mutable tag. Do not make the worker public. Record a sanitized deployment digest and
status reference.

## 7. Direct capture

- Leave browser disabled.
- Submit one founder-authorized URL/text capture through `user_capture`.
- Confirm the URL remains inert unless a separate connector operation is allowed.
- Confirm raw immutable provenance, normalization, dedupe, ranking, and activity events.
- Repeat the same request and verify idempotency.

Record the sanitized test-run identifier for `direct_capture`.

## 8. Worker dispatch, duplicate, replay, and restart

- Enable only the private worker lane.
- Dispatch one approved non-browser job.
- Submit a duplicate dispatch and verify a single durable effect.
- Replay the result and verify it is rejected or idempotently ignored.
- Restart the worker after claim and verify lease-based recovery without concurrent replacement
  claims.
- Exercise provider outage behavior without leaking provider responses.

Record `maritime_worker_dispatch`, `duplicate_dispatch`, `replayed_result`,
`worker_restart_recovery`, and `provider_outage`.

## 9. Web Push

Keep Google integrations disabled. Enable notifications only for this phase:

```sh
VERA_NOTIFICATIONS_DISABLED=0
```

- Verify one generic delivery.
- Replay the notification and verify deduplication.
- Verify quiet-hours deferral.
- Remove or disable the test subscription, then return `VERA_NOTIFICATIONS_DISABLED=1`.

Never store a subscription endpoint or payload in evidence.

## 10. Gmail read-only

Keep browser and Web Push disabled. Clear the global integration switch only after the founder has
granted the separate Gmail read-only authorization; do not grant Calendar yet:

```sh
VERA_INTEGRATIONS_DISABLED=0
VERA_GMAIL_ALERTS_DISABLED=0
```

- Verify the grant is exactly `gmail.readonly`.
- Import one alert and verify repeat-import idempotency.
- Confirm there is no compose, draft, modify, or send capability in this release.
- Revoke or disconnect the test grant and return `VERA_GMAIL_ALERTS_DISABLED=1` before Calendar.

Use only workflow/test references and hashes; raw email bodies are forbidden.

## 11. Calendar free/busy and approved hold

With Gmail disabled, authorize only the Calendar scopes:

- verify free/busy;
- verify provider failure is not presented as empty availability;
- verify final conflict recheck;
- create a tentative Vera-owned hold only after exact approval;
- confirm no attendees and no notifications;
- verify duplicate hold prevention; and
- revoke or disconnect the staging grant, then return `VERA_INTEGRATIONS_DISABLED=1`.

No landlord invitation or external notification is permitted.

## 12. Browser-disabled enforcement and emergency disable

Collect mandatory positive proof that:

- `VERA_BROWSER_DISABLED=1`;
- founder/user/source/node/profile browser controls cannot be enabled;
- browser SourceJobs are rejected before Maritime dispatch;
- worker serve mode succeeds without a gateway agent ID;
- gateway variables are absent;
- no OpenClaw agent or public browser endpoint is deployed;
- production schedules contain no browser schedule kind; and
- the authenticated controls API rejects activation while the global switch is set.

Emergency disable order:

```sh
VERA_NOTIFICATIONS_DISABLED=1
VERA_GMAIL_ALERTS_DISABLED=1
VERA_INTEGRATIONS_DISABLED=1
VERA_BROWSER_DISABLED=1
maritime stop vera-worker
```

Stopping the worker is a separate remote mutation requiring approval. Browser gateway shutdown is
not part of core because no gateway may exist.

## 13. Rollback

Rollback is allowed only when the reviewed earlier worker passed schema compatibility against the
migrated database:

```sh
maritime history vera-worker -n 10
maritime deploy vera-worker --source docker --image 'ghcr.io/<owner>/vera-worker@sha256:<reviewed-rollback-worker-digest>' --wait
maritime status vera-worker --json
```

If schema compatibility is absent, do not deploy the earlier image. Stop the worker and use the
managed PostgreSQL restore procedure. Core rollback has no OpenClaw artifact.

## 14. Bundle generation, validation, and retention

Every record must use schema version 2, `releaseProfile: "founder_core"`, the exact capability
object, exact source commit, exact environment, exact worker digest, and
`candidateOpenclawImage: null`. Recompute each canonical record hash after its final edit, sort
records in the registry phase order, compute the canonical bundle SHA-256, and optionally bind an
operator or CI signature to that exact hash.

Run the profile-aware gate:

```sh
VERA_FOUNDER_STAGING_SMOKE=1 \
VERA_RELEASE_PROFILE=founder_core \
VERA_RELEASE_ID='<opaque-release-id>' \
VERA_RELEASE_ENVIRONMENT_ID='<opaque-staging-environment-id>' \
VERA_RELEASE_SOURCE_COMMIT="$CANDIDATE_SHA" \
VERA_CANDIDATE_WORKER_IMAGE='ghcr.io/<owner>/vera-worker@sha256:<candidate-worker-digest>' \
VERA_RELEASE_EVIDENCE_PATH='release-evidence/private/founder-core-bundle.json' \
pnpm test:staging:founder-release
```

Do not set an OpenClaw image or gateway variable in that command.

Copy the completed bundle and referenced private artifacts to a restricted private release-artifact
store. Record its private object locator and checksum in the operator change. Apply
`PRIVACY_OPERATIONS.md` retention/deletion policy, then securely delete the local copies when the
retention handoff is verified. The local directory is not the permanent audit store.

## Classification checklist

`conditional_go_founder_only_staging` requires:

- every completed required phase passed;
- every remaining required phase has a valid strict configuration blocker;
- each blocker names the missing external value/credential/deployment/operator execution and a
  concrete remediation;
- implementation and validators exist;
- all non-live tests pass; and
- no remediation needs code or an unresolved design decision.

`go_founder_only_core_beta` requires every founder-core phase to pass with no block.

Any failure, provider failure, mandatory N/A, missing phase, stale or invalid evidence, profile or
capability mismatch, commit/environment/digest mismatch, implementation gap, test failure, policy
gap, security finding, or unresolved architecture forces `no_go`.

Neither allowed founder-core classification authorizes a browser-enabled beta or a multi-user
browser beta. ADR 0012 keeps `founder_browser_experimental` `no_go` until a replacement decision is
approved.
