# Gateway State-Symlink Restart Repair Design

## Context

The corrected DigitalOcean Gateway passed first-boot backend-local and public WSS acceptance. A later password-reset reboot deterministically failed `vera-browser-gateway-bootstrap.service` during `container_readiness`. The container repeatedly exited with:

```text
Error: Gateway state tree must not contain symbolic links.
```

The only link in the persisted state tree was created by the reviewed Gateway itself:

```text
.openclaw/plugin-skills/browser-automation
  -> /app/dist/extensions/browser/skills/browser-automation
```

The fail-closed bootstrap then removed the failed container and network. No direct Droplet ingress was opened.

## Goal

Make the immutable Gateway reproducibly restartable without weakening its state-tree symlink defense, changing its UID/GID, or changing the signed image digest.

## Considered Approaches

### 1. Exact-link reconciliation in the bootstrap — selected

After stopping the previous container and before creating the next one, inventory every symlink below the persistent state directory. Accept only the exact Gateway-created relative path when its target is the exact immutable in-image browser-automation directory. Remove that one link and require the remaining inventory to be empty.

This preserves all legitimate state, keeps unexpected links fail-closed, and does not alter the signed image.

### 2. Wipe persistent state on every restart — rejected

Deleting the entire state directory would avoid the restart failure but would also discard pairing and Gateway state. It would hide rather than reconcile the image’s deterministic output and would weaken reproducibility.

### 3. Rebuild the Gateway image — deferred

The image could copy or recreate the browser skill without persisting a link, but that would require a new source revision, image digest, signature, attestation, vulnerability scan, and security review. It is unnecessary for this narrowly proven failure.

## Bootstrap Design

Add a `sanitize_persisted_state_links` function to the embedded bootstrap script. The function accepts the persistent state directory as its only argument and:

1. creates a mode-private temporary inventory under the runtime root;
2. uses `find -P ... -xdev -type l -print0` so traversal never follows links or crosses filesystems;
3. validates the complete inventory before changing anything;
4. permits at most the exact relative path `.openclaw/plugin-skills/browser-automation`;
5. requires `readlink` to return exactly `/app/dist/extensions/browser/skills/browser-automation`;
6. fails without removing anything when any unexpected path, target, or additional link exists;
7. removes only the validated exact link; and
8. succeeds when no link exists, making repeated reconciliation idempotent.

Call the function in `runtime_recreation` immediately after `remove_runtime` stops and removes the prior container. This eliminates a concurrent writer during validation. A validation failure continues through the existing `ERR` trap, records the visible failed stage, removes runtime surfaces, and leaves the suspicious state entry intact for diagnostics.

The Gateway image digest, source revision, runtime identity `1000:1000`, read-only filesystem, capability drop, route filter, Origin checks, pairing rules, port bindings, and firewall policy remain unchanged.

## Error Handling

The primary failed stage for a rejected state link is `state_link_reconciliation`. The provisioning result remains `status: "failed"` with `backendLocalReady: false`, `publicEndpointReady: false`, and `wssAcceptanceStarted: false`.

No unexpected link is silently deleted. The correction handles only the one exact self-created link proven by the Recovery Console evidence.

## Automated Validation

Extend `infra/digitalocean/browser-gateway/validate.sh` to extract the embedded function and execute temporary-state regression cases:

- an empty state tree succeeds;
- the exact link is removed;
- running the function again succeeds;
- the exact path with a mismatched target fails and remains;
- an unexpected link fails and remains; and
- an exact link plus any additional link fails without removing either.

Retain the existing cloud-config schema, embedded Bash syntax, systemd unit, immutable-digest, secret-placeholder, VPC-only binding, bounded-timeout, and fail-closed checks. Extend the TypeScript verifier’s required invariants so removing the reconciliation stage or exact policy markers becomes a release failure.

## Acceptance and Rollout

After local validation:

1. preserve the sanitized reboot diagnostic;
2. delete the failed Droplet and its run-owned temporary resources;
3. render the corrected template with fresh disposable credentials;
4. create one fresh diagnostics-first Droplet behind zero public Gateway ingress;
5. prove first bootstrap and a second service restart both pass;
6. repeat backend-local security and WSS gates;
7. recreate managed HTTPS ingress and repeat public WSS;
8. pair the official extension, share exactly one `https://example.com/` tab, capture one minimized snapshot, unshare, and prove `no_shared_tab`;
9. revoke credentials and remove every run-owned cloud, DNS, browser-profile, Keychain, and temporary-file resource; and
10. publish only sanitized evidence and its SHA-256.

Milestone 13B remains outside this design and is not authorized.
