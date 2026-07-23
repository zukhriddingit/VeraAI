# OpenClaw gateway and local-node operations

Vera pins OpenClaw `2026.6.33` for both gateway compatibility and the local node. Maritime's current OpenClaw guide still names `2026.5.28`; Vera does not deploy that template pin because it is below the reviewed security floor. The official patched image is deployed explicitly:

```sh
maritime deploy vera-openclaw-gateway --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
```

The founder already has an OpenClaw deployment in Maritime. The command above is an approved-form
example only, not a step to execute before inventory. Adopt the existing agent if and only if its
observed version, exposure, effective configuration, and rollback identity satisfy this review.

## Reviewed configuration boundary

- `infra/maritime/openclaw/openclaw.json5` is the desired gateway config. Gateway plugins, agent
  tools, channels, cron, Control UI, and model endpoints remain disabled. Browser routing pins one
  explicit node and the effective node command set is verified as exactly `browser.proxy`.
- `infra/maritime/openclaw/node.openclaw.json5` is the desired local-node config. It enables only
  the bundled browser plugin, disables page evaluation, disables prompt/conversation hooks, and
  permits only profile `vera-zillow`.
- `pnpm verify:openclaw-config` validates both files with the pinned CLI, verifies the enabled
  plugin inventories, and runs OpenClaw's own runtime and pairing allowlist resolvers for every
  supported/unknown platform.

OpenClaw `2026.6.33` does not provide a path-level allowlist inside `browser.proxy`. That
administrative capability can proxy more browser operations than Vera uses. Vera's adapter emits
only `GET /tabs` and `GET /snapshot`, uses one exact matching Zillow tab, and requests no
navigation or interaction, but this is an application restriction—not a native transport-enforced
read-only guarantee. Protect the gateway credential accordingly. The connector remains
founder-only, `experimental_personal`, disabled by default, and is not approved for multi-user
beta. A future narrow node-side command/plugin must replace broad `browser.proxy` before claiming
transport-enforced read-only access.

## Pair the founder-controlled node

1. Install the exact local version with `npm install --global openclaw@2026.6.33`.
2. Configure the reviewed public gateway as a TLS `wss` remote and provide the gateway token through the local protected environment.
3. Start the node host with the current supported command:

```sh
openclaw node run --host <gateway-host> --port 443 --tls --display-name "Vera Founder Browser"
```

4. On an authenticated operator client, complete both device pairing and node capability approval.
   Re-list immediately before each approval so a superseded request ID cannot be approved:

```sh
openclaw devices list
openclaw devices approve <request-id>
openclaw nodes pending
openclaw nodes approve <request-id>
openclaw nodes status
openclaw nodes describe --node <node-id>
```

5. Create/select a dedicated profile named `vera-zillow`, sign in manually, and register only the non-secret node/profile identifiers in Vera with `pnpm openclaw:register-node`.
6. Keep user/source controls disabled until the exact node, profile, URL, version, and `browser.proxy` capability have been reviewed.

Never ask Vera, Maritime, OpenClaw automation, an LLM, or Codex to type or store a marketplace password. `browser.proxy` is admin-sensitive and must be approved only for this dedicated founder node/profile after reviewing the exact declared surface. Never approve `system.run`, filesystem, camera, microphone, notification, shell, compose, send, apply, payment, upload, or download commands for Vera's browser node.

## Health and incompatibility

Gateway deployment status is reconciled through Maritime. Browser node heartbeat, pairing, capability approval, selected profile, and version are stored as non-secret Vera state. An offline or stale node defers the job visibly. Pairing, capability, login, 2FA, CAPTCHA, consent, challenge, stale snapshot, layout uncertainty, or version mismatch becomes a manual-action state.

Upgrade the gateway first, then the node. Before changing the pin, review upstream release notes, the native pairing/browser-proxy contract, security advisories, serialization tests, and the live opt-in smoke test. A version outside Vera's exact pin is incompatible even if OpenClaw offers an N-1 protocol window.

## Revocation and rollback

Revoke a node without deleting Vera evidence:

```sh
openclaw nodes remove --node <node-id>
```

Disable Vera's browser and source kill switches before gateway maintenance. Redeploy the reviewed pin if configuration drift occurs:

```sh
maritime deploy vera-openclaw-gateway --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
maritime restart vera-openclaw-gateway
```

Do not restore the historical Maritime template image. A different rollback version requires its own recorded security review.

## Privacy boundary

The local browser profile and authenticated session artifacts remain on the founder's machine. The selected page's minimal content needed to produce a structured `RawListing` may traverse the configured OpenClaw gateway and Vera worker. Vera does not persist full screenshots, snapshots, cookies, storage, profile paths, or raw private pages by default. Logs and audit events carry only correlation IDs, hashes, safe state codes, and non-secret deployment references.
