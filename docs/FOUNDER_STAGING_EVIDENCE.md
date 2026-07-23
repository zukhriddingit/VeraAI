# Founder staging evidence procedure

Status: required before a founder-staging release decision

The checked-in schema and validators are not a private audit store. Real evidence exists only below
the explicit external input directory `release-evidence/private/`, which is Git-ignored. Create the
directory with mode `0700` and each evidence file with mode `0600`. Do not commit, attach to a public
issue, or paste real records into chat.

```sh
mkdir -m 700 -p release-evidence/private
umask 077
# Write private JSON evidence through approved operator tooling, then verify its mode is 600.
# Run the gate only with the explicit VERA_FOUNDER_STAGING_SMOKE=1 release environment.
```

The gate accepts only a closed, schema-validated `ReleaseEvidenceBundle`. It rejects a path outside
the private directory, symlinks, group/world-readable files, arbitrary fields, missing/mismatched
content hashes, mixed release identities, mutable image tags, and synthetic fixtures. Committed
examples in `scripts/staging/examples/` are visibly synthetic and are rejected by the production
release gate; the validator's `allowSynthetic` option is for isolated unit tests only and is never
enabled by the production command.

## Required record fields

Each record has exactly these release-binding fields:

- schema version and `synthetic: false`;
- named mandatory phase identifier;
- opaque release/environment/operator references;
- exact 40-character source commit;
- candidate worker digest and, when relevant, candidate OpenClaw digest;
- UTC execution time;
- bounded sanitized expected and observed result;
- one allowed result state;
- approved sanitized evidence references, each with a SHA-256;
- `approvalState: "approved"`; and
- a SHA-256 `contentHash` of canonical record content excluding that field.

The only result states are `passed_automated`, `passed_manual_evidence`,
`blocked_missing_configuration`, `failed_assertion`, `failed_provider`, and
`not_applicable_with_approved_reason`. A mandatory phase passes only with either `passed_automated`
or `passed_manual_evidence`. A blocked state is visible failure, never a skip or success.

Use references and hashes, not raw artifacts. Approved reference forms are GitHub Actions artifact
names, managed database snapshot references, private-object IDs, sanitized screenshot checksums,
test-run IDs, workflow-run IDs, and deployment digests. Ordinary unit tests validate their shape and
hashes only; an operator separately verifies the private artifact exists before a release decision.

## Redaction boundary

The schema allowlists fields before applying defense-in-depth secret scanning. Never put OAuth access
or refresh tokens, API keys, database URLs, passwords, cookies, authorization headers, private keys,
raw environment files, raw email bodies, phone numbers, full browser snapshots, profile paths, node
or profile IDs, or PostgreSQL dumps in a record, reference, expected result, or observed result.

Describe outcomes with safe codes, for example `gateway_denied_invalid_token` or
`managed_restore_count_match`; do not copy provider payloads or raw logs. A validator rejection is a
release-gate failure: redact and regenerate the record rather than weakening the schema.

## Collection matrix

| Phase family | Evidence procedure |
| --- | --- |
| Gateway and worker recovery | Record the sanitized test-run/workflow reference for unauthenticated and wrong-token denial, dispatch, duplicate/replay, kill-switch, crash, restart, and provider-outage checks. |
| Browser/node | Current Maritime staging has no approved ingress. Record its `blocked_missing_configuration` result; do not manufacture a positive-capture record. Node-offline, stale-heartbeat, and manual-blocker records must use safe state codes only. |
| Web Push | Record delivery, idempotency, and quiet-hours test references; no endpoint, subscription, or notification payload is evidence. |
| PostgreSQL/rollback | Record a managed snapshot reference hash, restore rehearsal reference, prior-worker digest, compatibility evidence hash, and candidate digest. If compatibility is absent, record a blocked rollback phase. |
| Gmail | From Vera settings, verify Web OAuth requests exactly `gmail.readonly`, no compose/modify/broad mail scope, one alert import, repeat-import idempotency, and no unnecessary content retention. Store only console/test references and hashes. |
| Calendar | Verify `calendar.freebusy` is requested separately, the Vera-only fallback is visible, temporary Google failure is not empty availability, final conflict recheck succeeds, `calendar.events.owned` is requested separately, holds have no attendees/no notifications, and duplicate holds are prevented. |

## Bundle, signature, and final decision

The final private bundle contains all accepted phase records, a common release ID/environment/source
commit/candidate image binding, a deterministic canonical SHA-256 `bundleHash`, and optional opaque
CI or operator signature metadata. A signature must name the exact `signedBundleHash`; external CI
or operator tooling performs the cryptographic verification. The bundle hash excludes its own hash
and signature fields to avoid circularity. The validator rejects any declared record hash mismatch
and any mixed commit, environment, worker digest, or applicable OpenClaw digest.

After an approved release-gate run, copy the full evidence bundle and referenced private artifacts to
a restricted private release-artifact store. Apply the retention/deletion process in
[`PRIVACY_OPERATIONS.md`](./PRIVACY_OPERATIONS.md); do not treat the local private directory as a
permanent audit store. The shareable final decision may contain only the release ID, source commit,
immutable worker/OpenClaw digests, bundle SHA-256, classification, and approval timestamp.
