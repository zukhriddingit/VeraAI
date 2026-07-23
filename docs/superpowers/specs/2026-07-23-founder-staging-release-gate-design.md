# Founder staging release gate design

**Status:** Approved for implementation on 2026-07-23

## Goal

Replace the current no-go smoke-test placeholder with a fail-closed founder-staging release gate. The gate can classify a release as conditional go only after every required phase has automated proof or accepted, privacy-safe manual evidence. It creates artifacts and records evidence; it never deploys, dispatches jobs, changes Maritime, enables browser scheduling, or creates/sends Gmail messages.

## Scope and boundaries

- Real evidence is external-only at `release-evidence/private/`. The directory is gitignored, must be mode `0700`, and individual files must be mode `0600`.
- Git contains only schemas, validators, synthetic non-releasable examples, procedures, and tests. The final sanitized decision contains references and hashes, never raw evidence.
- Every evidence record and bundle is a closed schema: unknown fields are rejected before secret scanning is considered.
- The Maritime browser ingress decision is **blocked** for staging. The current official documentation describes public/no-login web exposure but no documented authenticated, allowlisted private WSS topology for a founder local node. Non-browser worker checks remain eligible for staging.
- The release workflow remains `workflow_dispatch` only and builds/reviews an immutable artifact. It has no Maritime lifecycle, deployment, trigger, pairing, or configuration operation.

## Evidence model

`release-evidence/private/` is an explicit runtime input selected by the operator. The validator rejects paths outside that directory, symlinks, permissive modes, malformed JSON, and synthetic fixture records unless a test-only flag is set.

Each record binds a single named phase to a release ID, environment ID, 40-character source commit, immutable worker digest, applicable immutable OpenClaw digest, UTC execution time, opaque operator reference, bounded expected/observed results, result state, allowlisted evidence references/hashes, approval, and its canonical SHA-256 content hash. The canonical content excludes its own `contentHash` member. It rejects credentials, private data, raw browser/state identifiers, raw email/snapshot content, and database dumps by field shape and defense-in-depth pattern scanning.

A deterministic release bundle contains the shared release binding plus the accepted records in phase order. Its canonical serialization is hashed and may contain an optional opaque signature reference and signature value. A phase can pass only with `passed_automated` or `passed_manual_evidence`; all required phase records must be present. Mixed commits, environments, or candidate digests fail.

## Required phase model

The harness uses exactly these mandatory phase identifiers:

1. `gateway_unauthenticated_request`
2. `gateway_wrong_token`
3. `maritime_worker_dispatch`
4. `founder_positive_current_tab_capture`
5. `node_offline`
6. `stale_heartbeat`
7. `manual_login_2fa_captcha_blocker`
8. `kill_switch_after_queueing`
9. `worker_crash_after_browser_invocation`
10. `duplicate_dispatch`
11. `replayed_result`
12. `gateway_restart`
13. `web_push_delivery`
14. `web_push_deduplication`
15. `quiet_hours`
16. `provider_outage`
17. `worker_image_rollback`
18. `postgresql_restore`
19. `gmail_readonly_verification`
20. `calendar_freebusy_and_approved_hold`

Every phase has either a safe automated runner or a strict manual-evidence validator. Missing configuration produces `blocked_missing_configuration`, not a pass. Browser capture is represented as an explicit blocked phase until a supported ingress ADR changes that policy; therefore the overall release remains non-passing until valid manual evidence or a future approved topology permits it.

## Artifact and rollback model

The workflow runs only from the default branch. Its optional `source_sha` is a full hexadecimal SHA that is verified locally to exist, be reachable from `main`, and resolve to the repository checkout rather than a fork or arbitrary remote. The workflow checks out the default branch for workflow code, fetches the selected trusted source commit, builds it, and records the resulting digest. It retains SBOM, scan, provenance, signature, and verification evidence without deployment.

The final release manifest records candidate and reviewed rollback digests for worker and OpenClaw. The documented first-release sequence is: create/verify a baseline artifact from the prior trusted main commit, record it as rollback, create/verify the candidate from the merged release commit, then record both before any deployment. An image rollback is rejected when the selected earlier application has not passed the schema-compatibility gate.

## Validation and documentation

Static validators reject mutable production references in release/staging deployment documentation and workflow source selection that fails the trusted-commit rules. Google procedures use manual evidence for real consent/account checks while retaining existing Gmail read-only and Calendar approval boundaries. The release procedures require copying the complete external evidence bundle to a restricted private artifact store and applying the retention/deletion policy in `PRIVACY_OPERATIONS.md`.

