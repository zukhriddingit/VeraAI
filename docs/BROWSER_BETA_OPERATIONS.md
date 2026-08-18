# Browser Connector private-beta operations

Status: implementation ready; activation blocked until the private Chrome Web Store item and the authenticated privacy lifecycle pass live rehearsal. This runbook never enables a tester automatically.

Vera uses one isolated browser deployment per approved tester. Each assignment has one Vera user, one approved node/profile, one Maritime agent, one Gateway/checkpoint container set, one relay credential, one checkpoint credential, and one plan-signing key. PostgreSQL stores routing identity, enrollment-device state, an opaque secret reference, and SHA-256 digests only. It never stores raw enrollment tickets, relay, checkpoint, Maritime, bootstrap-seed, or signing values.

The accepted Milestone 13B Gateway image remains an immutable rollback artifact:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde
```

The immutable 13A rollback/reference image remains:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd
```

Do not rebuild either image merely to provision a tester. One-click enrollment adds an objectively
missing bounded Gateway primitive, so activation requires one new signed, SBOM-attested image built
from the merged enrollment commit. Never overwrite or relabel either accepted digest.

## Activation gates

Stop before provisioning unless all are true:

- the application release is merged, green, and deployed;
- `/api/ready` is ready and the PostgreSQL migration is current;
- the founder is an active beta member and exact browser-beta UUID;
- the Chrome Web Store item is privately published to the intended tester;
- privacy/support pages are live and authenticated export/deletion plus offline restore reapplication are deployed and live rehearsed;
- the browser kill switch works and there are zero active browser runs;
- the existing database is backed up and current listing counts are recorded without selecting private content;
- the exact recurring DigitalOcean cost for the tester's dedicated Droplet and Regional Load Balancer has separate human approval.

Keep `VERA_BETA_ACCESS_GATE_ENABLED=0`, `VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0`,
`VERA_BROWSER_ENROLLMENT_ENABLED=0`, and `VERA_BROWSER_DISABLED=1` while any gate is incomplete.

## Secret namespaces

The web runtime receives only these non-secret controls:

```dotenv
VERA_BROWSER_BETA_USER_IDS=
VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0
VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION=sha256.v1
VERA_BROWSER_ENROLLMENT_ENABLED=0
VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL=
VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN=
```

For an assignment whose validated reference is `TESTER_A_202608`, configure these values in the server secret store without printing them:

```text
VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY
VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY
```

The assigned Gateway/checkpoint deployment receives its own raw relay, checkpoint, bootstrap seed,
and scoped Maritime values. The raw checkpoint value exists only in the assigned sidecar/secret
store; PostgreSQL receives its SHA-256 digest. The extension receives the relay credential only after
an authenticated 60-second ticket is consumed. Do not put any raw value in command arguments,
terminal output, logs, evidence, Git, the Vera page, or the clipboard.

## Founder migration sequence

1. Set `VERA_BROWSER_DISABLED=1` and verify zero queued, dispatched, or running browser jobs.
2. Verify `/api/ready`, application/worker health, database counts, the current Gateway image/signature, checkpoint health, and current assignment absence. Repair a local tunnel if needed; do not redeploy for a tunnel failure.
3. Back up PostgreSQL, run the additive migrations, and verify the migration ledger. Preserve all listing and private acceptance data.
4. Register exactly one paired/approved founder node and profile. Enable only reviewed user/source controls.
5. Generate fresh relay, checkpoint, bootstrap-seed, signing, and scoped Maritime values through the approved secret flow. Never print or recover a previous value.
6. Write only the lowercase SHA-256 relay/checkpoint digests to separate private regular files with mode `0600` and no trailing newline.
7. Create a pending assignment:

   ```bash
   pnpm tsx scripts/provision-browser-beta-assignment.ts \
     --confirm-user <exact-vera-uuid> \
     --node-id <approved-node-id> \
     --agent-id <dedicated-maritime-agent-id> \
     --gateway-origin https://<dedicated-gateway-host> \
     --secret-reference <UPPERCASE_REFERENCE> \
     --relay-digest-file <private-0600-file> \
     --checkpoint-digest-file <private-0600-file>
   ```

   Output is limited to assignment UUID, Vera UUID, `pending`, and secret reference.

8. Rotate the Vera bootstrap seed. Stop and recreate only the stateless Gateway and checkpoint
   containers using the newly signed enrollment-capable image, the same hostnames and existing
   browser limits, and the exact enrollment/research checkpoint wiring. Do not stop, recreate,
   restore, or copy PostgreSQL.
9. Verify the new Gateway/checkpoint health, then delete the old relay credential. Store the scoped server secrets and the raw checkpoint only at their intended endpoints.
10. Sign in to Vera in the intended Chrome profile, accept the read-only disclosure, and click
    **Connect this browser**. Verify the connector remains connected across an extension restart and
    that shared-tab count is still zero. Then share exactly one dedicated Vera Search tab.
11. Run external Gateway/checkpoint smokes, then activate the pending assignment:

    ```bash
    pnpm tsx scripts/provision-browser-beta-assignment.ts \
      --activate-assignment <assignment-uuid>
    ```

12. Set the exact founder UUID in `VERA_BROWSER_BETA_USER_IDS`, set
    `VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=1` and `VERA_BROWSER_ENROLLMENT_ENABLED=1`, keep the hash
    version at `sha256.v1`, set `VERA_WORKER_BROWSER_DISABLED=1` so the normalization worker remains
    unable to execute browser work while the web process uses the assignment-routed client, and
    remove the legacy global founder/Gateway/checkpoint/local-bridge selectors from the active
    release.
13. Run `pnpm verify:browser-assignments`, restart the paired web/worker release, verify `/api/ready`, then clear `VERA_BROWSER_DISABLED` only for the acceptance window.

## Required founder acceptance

Run the existing user-triggered four-source search. Verify each dispatch, checkpoint, RawListing, provenance field, normalized record, canonical record, score, and activity event belongs to the founder. Verify successful sources survive another source's typed failure and forbidden-action count is zero.

Then unshare the tab and require a follow-up browser run to return `tab_required`/`no_shared_tab`
with zero imports. Invoke server revocation from Vera, verify the page clears the local extension
credential, rotate/delete raw credentials, and verify shared tabs `0`, established connections `0`,
and clipboard bytes `0`. Record only safe IDs, counts, action types, timestamps, and hashes in the
gitignored private evidence directory.

## Rollback

Keep the browser kill switch on. Roll back the application release and its exact compatible
configuration, but never restore an old enrollment ticket, relay, bootstrap, or checkpoint
credential. A rollback must not delete assignment rows, listing data, provenance, or append-only
audit history. Re-enabling browser work requires new credentials and a fresh acceptance.

## Wave 1

Do not provision nonfounder testers until the Store gate and SEC-013 live rehearsal are complete.
The rehearsal uses a disposable invited owner, never the founder: export its data, delete it through
the authenticated two-step UI, prove another owner is unchanged, prove its sessions/browser access
are revoked, restore an isolated pre-deletion backup with traffic disabled, and run
`pnpm privacy:reapply-deletions` with the protected receipt ledger. Require `failed: 0`, the restored
owner absent, and only count/hash evidence under `release-evidence/private/` before changing any
nonfounder gate.

Provision one
isolated deployment at a time, never sharing a Droplet, load balancer, container set, Maritime agent,
or credential set. After each tester, prove exact-owner routing, wrong-owner `run_not_active`,
connection-with-zero-shared-tabs, unshare stop, server revocation plus local credential clearing, zero
connections/clipboard bytes, and zero forbidden actions.

The evidence command is advisory only:

```bash
pnpm browser-beta:evidence evaluate --ledger <private-sanitized-ledger.json>
```

It cannot change Store testers, assignments, infrastructure, secrets, or application flags.
