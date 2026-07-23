# Founder-core release profile design

**Status:** Approved for implementation on 2026-07-23

## Goal

Add explicit capability-scoped release profiles to Vera's founder staging evidence gate so the
non-browser founder core can be staged and promoted without weakening the browser-enabled gate.
The selected profile, exact capability set, source commit, environment, and immutable candidate
digests must be inseparable parts of every evidence record, evidence bundle, release manifest, and
final decision.

This change does not deploy infrastructure, dispatch a workflow, start an OpenClaw gateway, enable
browser capture, expose a Maritime agent, or add a product capability.

## Profiles

The release gate recognizes exactly two profiles:

| Profile | browserCapture | directCapture | gmailAlerts | calendar | webPush | maritimeWorker |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `founder_core` | false | true | true | true | true | true |
| `founder_browser_experimental` | true | true | true | true | true | true |

The capability object is closed and derived from the profile registry. Operators cannot override an
individual capability in evidence or in a release manifest. A record or bundle whose declared
capabilities do not exactly equal its selected profile is invalid.

`founder_browser_experimental` is release-ineligible while ADR 0012 remains unresolved. Even a
complete set of passing browser evidence therefore classifies as `no_go`. Removing that restriction
requires a separate ADR and code review; evidence alone cannot change it.

## Required phase sets

Every profile includes the following founder-core non-browser requirements:

1. `release_static_readiness`
2. `postgresql_snapshot_and_backup`
3. `postgresql_restore`
4. `migration_and_idempotent_bootstrap`
5. `hosted_web_deployment`
6. `maritime_worker_dispatch`
7. `direct_capture`
8. `duplicate_dispatch`
9. `replayed_result`
10. `worker_restart_recovery`
11. `web_push_delivery`
12. `web_push_deduplication`
13. `quiet_hours`
14. `provider_outage`
15. `gmail_readonly_verification`
16. `calendar_freebusy_and_approved_hold`
17. `emergency_disable`
18. `worker_image_rollback`

For `founder_core`, the browser-positive requirements are replaced before evaluation with these
mandatory browser-disabled requirements:

1. `browser_global_kill_switch_enabled`
2. `browser_founder_capability_disabled`
3. `browser_source_jobs_rejected_before_dispatch`
4. `browser_gateway_not_required`
5. `browser_endpoint_not_exposed`
6. `browser_monitoring_not_scheduled`
7. `browser_activation_not_exposed`

These records are not N/A substitutes. They are required positive proof that the selected core
profile cannot perform browser work.

For `founder_browser_experimental`, the browser-disabled phases are absent and these browser-live
requirements are mandatory:

1. `gateway_unauthenticated_request`
2. `gateway_wrong_token`
3. `founder_positive_current_tab_capture`
4. `node_offline`
5. `stale_heartbeat`
6. `manual_login_2fa_captcha_blocker`
7. `kill_switch_after_queueing`
8. `worker_crash_after_browser_invocation`
9. `gateway_restart`

The required phase set is selected from the profile registry before evaluating any records.
`not_applicable_with_approved_reason` never removes or satisfies a mandatory requirement.

## Evidence schema version 2

Version 2 adds these required record and bundle fields:

- `releaseProfile`
- `capabilities`
- `configurationBlocker`

`configurationBlocker` is null unless `resultState` is `blocked_missing_configuration`. A non-null
configuration blocker is a closed object:

```ts
interface ConfigurationBlocker {
  readonly kind:
    | "external_staging_value"
    | "external_credential"
    | "external_deployment"
    | "operator_execution";
  readonly missingConfiguration: string;
  readonly remediation: string;
  readonly implementationState: "implemented_and_validated";
  readonly nonLiveValidationState: "passed";
  readonly requiresRepositoryChange: false;
  readonly requiresDesignDecision: false;
}
```

The schema and validator reject a configuration blocker that:

- appears on a phase that is static or otherwise not allowed to block on configuration;
- omits a concrete safe remediation;
- requires a repository code change or an unresolved design decision;
- does not attest that the implementation, validator, and non-live validation already pass; or
- describes a missing runner, unimplemented feature, failing test, undecided architecture,
  incomplete policy, mocked-only production path, unresolved schema gap, or unresolved security
  finding.

The evidence schemas remain closed before defense-in-depth secret scanning. Real evidence remains
external under `release-evidence/private/`, mode `0700`, with files mode `0600`. Committed examples
remain synthetic, non-releasable, and accepted only with the existing test flag.

`candidateOpenclawImage` is null for `founder_core` and an immutable OCI digest for
`founder_browser_experimental`. The bundle validator rejects a profile/digest combination that does
not follow that rule.

## Classification

The classifier returns exactly one of:

- `no_go`
- `conditional_go_founder_only_staging`
- `go_founder_only_core_beta`

For `founder_core`:

- Every required record passing with `passed_automated` or `passed_manual_evidence` yields
  `go_founder_only_core_beta`.
- A mixture of passing records and valid `blocked_missing_configuration` records yields
  `conditional_go_founder_only_staging` only when at least one valid configuration blocker remains.
- Any schema, hash, signature, freshness, identity, commit, environment, profile, capability, or
  digest violation yields `no_go`.
- Any missing or duplicate required phase yields `no_go`.
- `failed_assertion`, `failed_provider`, or `not_applicable_with_approved_reason` on any mandatory
  phase yields `no_go`.
- Any invalid configuration blocker or implementation/design gap yields `no_go`.

Evidence is stale when a record or bundle is dated after the requested decision instant, when a
record is dated after the bundle was created, or when a record or bundle is more than seven days old
at the decision instant. The classifier accepts an explicit decision instant so tests and CI remain
deterministic.

`founder_browser_experimental` always yields `no_go` while its profile registry entry is marked
release-ineligible. This unresolved ingress decision does not affect `founder_core`.

## Release manifest and final summary

Release manifest schema version 2 binds:

- the selected release profile;
- the exact closed capability object;
- the source commit;
- the candidate worker artifact;
- the reviewed rollback worker artifact; and
- OpenClaw candidate and rollback artifacts only for `founder_browser_experimental`.

`founder_core` manifests require `openclaw: null` and
`rollback.reviewedOpenclawImage: null`; they do not create or imply an OpenClaw deployment.
`founder_browser_experimental` retains the pinned immutable OpenClaw supply-chain contract.

A sanitized decision summary contains the release ID, profile, capabilities, source commit,
immutable worker digest, nullable immutable OpenClaw digest, evidence bundle SHA-256, classification,
and approval timestamp. It never embeds the private phase records.

## Product boundary hardening

The existing worker and web runtime policies default `VERA_BROWSER_DISABLED` to true, and browser
capture jobs are policy-checked before dispatch. The browser controls mutation service must also
reject attempts to enable user, source, node, or profile browser controls while the system browser
kill switch is active. This prevents an authenticated UI or API request from storing latent browser
activation during a `founder_core` release.

Production schedules have no browser schedule kind. This fact remains protected by existing domain
schema tests and becomes a required evidence phase rather than a silent assumption.

## Smoke gate and operator procedure

The staging smoke gate requires `VERA_RELEASE_PROFILE`. Capabilities are derived, never read from
environment variables. `VERA_CANDIDATE_OPENCLAW_IMAGE` is forbidden for `founder_core` and required
for `founder_browser_experimental`.

Missing runners, implementation gaps, or unresolved design work report a failing result and force
`no_go`; they are never synthesized as configuration blockers. A phase may report
`blocked_missing_configuration` only through a validated private record with the strict blocker
object above.

The founder-core runbook starts all external capabilities disabled, enables one capability at a
time, keeps the browser gateway absent or stopped, and records each mandatory phase. The already
deployed `https://vera-ai-housing.vercel.app` landing page is treated as a marketing deployment, not
as founder-core application staging evidence, and is not redeployed by this procedure.

The release workflow is invoked separately for the reviewed rollback SHA and merged candidate SHA.
It only builds, scans, signs, attests, and uploads artifacts; it has no deployment side effect.

## Validation

Table-driven unit tests cover:

- all-pass, valid mixed pass/block, all-valid-block, and each always-no-go result state;
- missing, duplicate, invalid, stale, profile-mismatched, capability-mismatched, commit-mismatched,
  environment-mismatched, and digest-mismatched evidence;
- every prohibited configuration-blocker category;
- browser experimental release-ineligibility;
- deterministic bundle hashing with profile and capabilities;
- nullable versus required OpenClaw digests by profile;
- release manifest profile/capability/OpenClaw consistency;
- smoke-gate handling of missing runners and configuration blockers; and
- UI/API browser-control enablement denial under the global kill switch.

The final validation set includes focused Vitest files, release validators, lint, typecheck,
format-check, the full unit and integration suites, PostgreSQL integration tests, and production
builds.
