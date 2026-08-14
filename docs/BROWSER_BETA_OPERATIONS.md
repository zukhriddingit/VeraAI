# Browser Connector private-beta operations

Status: implementation ready; activation blocked until the private Chrome Web Store item and the authenticated privacy lifecycle are approved. This runbook never enables a tester automatically.

Vera uses one isolated browser deployment per approved tester. Each assignment has one Vera user, one approved node/profile, one Maritime agent, one Gateway/checkpoint container set, one relay credential, one checkpoint credential, and one plan-signing key. PostgreSQL stores routing identity, an opaque secret reference, and SHA-256 digests only. It never stores raw relay, checkpoint, Maritime, pairing, or signing values.

The approved Gateway image is immutable:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde
```

The immutable 13A rollback/reference image remains:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd
```

Do not rebuild either image merely to provision a tester.

## Activation gates

Stop before provisioning unless all are true:

- the application release is merged, green, and deployed;
- `/api/ready` is ready and the PostgreSQL migration is current;
- the founder is an active beta member and exact browser-beta UUID;
- the Chrome Web Store item is privately published to the intended tester;
- privacy/support pages are live and the authenticated export/deletion lifecycle is approved and rehearsed;
- the browser kill switch works and there are zero active browser runs;
- the existing database is backed up and current listing counts are recorded without selecting private content;
- the exact recurring DigitalOcean cost for the tester's dedicated Droplet and Regional Load Balancer has separate human approval.

Keep `VERA_BETA_ACCESS_GATE_ENABLED=0`, `VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0`, and `VERA_BROWSER_DISABLED=1` while any gate is incomplete.

## Secret namespaces

The web runtime receives only these non-secret controls:

```dotenv
VERA_BROWSER_BETA_USER_IDS=
VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=0
VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION=sha256.v1
```

For an assignment whose validated reference is `TESTER_A_202608`, configure these values in the server secret store without printing them:

```text
VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_MARITIME_API_KEY
VERA_BROWSER_ASSIGNMENT_TESTER_A_202608_PLAN_SIGNING_KEY
```

The assigned Gateway/checkpoint deployment receives its own raw relay, checkpoint, pairing, and scoped Maritime values. The raw checkpoint value exists only in the assigned sidecar/secret store; PostgreSQL receives its SHA-256 digest. Do not put raw values in command arguments, terminal output, logs, evidence, Git, or the clipboard beyond the one-time pairing transfer.

## Founder migration sequence

1. Set `VERA_BROWSER_DISABLED=1` and verify zero queued, dispatched, or running browser jobs.
2. Verify `/api/ready`, application/worker health, database counts, the current Gateway image/signature, checkpoint health, and current assignment absence. Repair a local tunnel if needed; do not redeploy for a tunnel failure.
3. Back up PostgreSQL, run the additive migrations, and verify the migration ledger. Preserve all listing and private acceptance data.
4. Register exactly one paired/approved founder node and profile. Enable only reviewed user/source controls.
5. Generate fresh relay, checkpoint, pairing-seed, signing, and scoped Maritime values through the approved secret flow. Never print or recover a previous value.
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

8. Rotate the Vera pairing seed. Stop and recreate only the stateless Gateway and checkpoint containers with the same immutable images, routes, hostnames, limits, and loopback checkpoint wiring. Do not stop, recreate, restore, or copy PostgreSQL.
9. Verify the new Gateway/checkpoint health, then delete the old relay credential. Store the scoped server secrets and the raw checkpoint only at their intended endpoints.
10. Transfer one fresh pairing value through the approved user-facing flow, pair the extension, share exactly one dedicated Vera Search tab, and clear the clipboard.
11. Run external Gateway/checkpoint smokes, then activate the pending assignment:

    ```bash
    pnpm tsx scripts/provision-browser-beta-assignment.ts \
      --activate-assignment <assignment-uuid>
    ```

12. Set the exact founder UUID in `VERA_BROWSER_BETA_USER_IDS`, set `VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED=1`, keep the hash version at `sha256.v1`, and remove the legacy global founder/Gateway/checkpoint/local-bridge selectors from the active release.
13. Run `pnpm verify:browser-assignments`, restart the paired web/worker release, verify `/api/ready`, then clear `VERA_BROWSER_DISABLED` only for the acceptance window.

## Required founder acceptance

Run the existing user-triggered four-source search. Verify each dispatch, checkpoint, RawListing, provenance field, normalized record, canonical record, score, and activity event belongs to the founder. Verify successful sources survive another source's typed failure and forbidden-action count is zero.

Then unshare the tab and require a follow-up browser run to return `tab_required`/`no_shared_tab` with zero imports. Invoke server assignment revocation, unpair the extension, rotate/delete raw credentials, and verify shared tabs `0`, established connections `0`, and clipboard bytes `0`. Record only safe IDs, counts, action types, timestamps, and hashes in the gitignored private evidence directory.

## Rollback

Keep the browser kill switch on. Roll back the application release and its exact compatible configuration, but never restore an old pairing, relay, or checkpoint credential. A rollback must not delete assignment rows, listing data, provenance, or append-only audit history. Re-enabling browser work requires new credentials and a fresh acceptance.

## Wave 1

Do not provision nonfounder testers until privacy and Store gates are complete. Provision one isolated deployment at a time, never sharing a Droplet, load balancer, container set, Maritime agent, or credential set. After each tester, prove exact-owner routing, wrong-owner `run_not_active`, unshare stop, server revocation, unpair, zero connections/clipboard bytes, and zero forbidden actions.

The evidence command is advisory only:

```bash
pnpm browser-beta:evidence evaluate --ledger <private-sanitized-ledger.json>
```

It cannot change Store testers, assignments, infrastructure, secrets, or application flags.
