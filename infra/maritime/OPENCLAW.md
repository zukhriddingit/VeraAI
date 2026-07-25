# OpenClaw direct remote-extension operations

ADR 0013 replaces the local-node ingress proposal for the founder browser spike. The founder
installs only the official OpenClaw Chrome extension. The extension makes a direct outbound WSS
connection to one dedicated per-user OpenClaw Gateway on Maritime; the founder does not install
OpenClaw, a node, a CLI, a daemon, Maritime Companion, or a local Vera agent.

OpenClaw `2026.7.1` is the first reviewed release that contains the direct remote Gateway extension
topology and `/browser/extension` route. The older `2026.6.33` live-search pin does not satisfy this
contract and remains isolated to Vera's existing non-browser RentCast analysis path. The founder
browser spike binds this immutable multi-platform image:

```text
ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c
```

That is the base for Vera's source-bound hardened Gateway image:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:182712543bb55f9858544bfa3f14152669f560e352b46c4e2f4612c631a40300
```

`infra/maritime/openclaw/remote-extension-image.json` records that published digest and keeps
`deployableBeforeLiveProxyAcceptance: false`. A separately authorized disposable transport spike
may deploy it only to collect the mandatory acceptance evidence. It is not an application release
authorization.

The preserved non-browser RentCast analysis path remains pinned to:

```text
ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee
```

That older image does not satisfy the direct remote-extension contract. The browser image must not
replace, reuse credentials from, or silently migrate the existing RentCast analysis agent.

## Reviewed configuration boundary

- `infra/maritime/openclaw/remote-extension.openclaw.json5` defines one extension-driver profile,
  disables browser evaluation, nodes, Control UI, model HTTP endpoints, terminal, canvas, A2UI,
  channels, cron, ACP, commands, updates, web access, exec, filesystem, messaging, and sessions.
- Only the bundled browser plugin and `vera-read-shared-tab` plugin are allowed. The model cannot use
  the bundled `browser` tool.
- `vera_read_shared_tab_snapshot` accepts an empty object, uses fixed loopback `GET /tabs` and
  `GET /snapshot` requests against the `chrome` profile, requires exactly one shared tab, minimizes
  the result, reduces the page URL to its origin, strips raw target IDs and sensitive data, and
  returns only bounded data plus hashes.
- `pnpm verify:remote-extension-config` verifies the immutable image, effective static boundary,
  separate browser-Gateway credential names, and absence of browser mutation operations.

The upstream relay accepts at most 64 MiB per frame. Vera's tool is independently stricter: 64 KiB
for tab inventory, 128 KiB for the raw accessibility snapshot, 32,768 source characters, 24
returned lines, 2,400 returned characters, and a five-second loopback timeout. The hosted Vera
client accepts at most 20 KiB and defaults to a 15-second request timeout.

## Pairing and consent

The pairing secret is a 32-byte base64url value. It is held in the extension URL fragment at rest
and sent in `Sec-WebSocket-Protocol` as `openclaw-extension-token.<secret>` alongside
`openclaw-extension-relay`. It must never be placed in a query string, Git, logs, chat, screenshots,
release summaries, or ordinary evidence records.

An authorized operator prepares the official extension package and pairing material in restricted
tooling associated with the dedicated Gateway. The founder receives only the extension and pairing
handoff; no local CLI is required. The founder explicitly places one intended tab in the OpenClaw
tab group before each snapshot. Removing the tab from that group revokes page access.

One Gateway, pairing secret, Vera browser API key, and agent ID belong to one Vera user. Never reuse
the existing live-search agent, its `MARITIME_API_KEY`, or its agent ID. Never share a Gateway
between unrelated renters.

## Public proxy acceptance — currently blocked

The only intended public application route is:

```text
wss://<dedicated-per-user-host>/browser/extension
```

Maritime's public documentation does not currently promise WebSocket upgrades, WSS,
`Sec-WebSocket-Protocol` preservation, path filtering, payload limits, idle timeouts, or connection
stability. The repository therefore does not claim those properties and does not authorize a
deployment.

After a dedicated disposable Gateway exists, an operator may run the opt-in private probe from a
restricted environment:

```sh
VERA_REMOTE_EXTENSION_PROXY_SMOKE=1 \
OPENCLAW_EXTENSION_GATEWAY_URL='wss://<dedicated-per-user-host>/browser/extension' \
OPENCLAW_EXTENSION_PAIRING_SECRET='<private-32-byte-base64url-secret>' \
pnpm test:staging:remote-extension-proxy
```

The probe checks unrelated-route denial, wrong-secret denial, the exact WSS upgrade, selected relay
subprotocol, a bounded stable connection, and client close behavior. Its output contains no host or
secret. It intentionally reports Maritime payload and idle-timeout limits as requiring separate
private provider evidence because a short connection test cannot prove those limits.

Before accepting internet exposure, also run both audits in the dedicated Gateway environment and
store only sanitized report references and hashes outside Git:

```sh
openclaw security audit
openclaw security audit --deep
```

Materialize the effective Gateway config outside Git at mode `0600` before either audit. A
read-only checkout mount is normally mode `0644` and will correctly trigger OpenClaw's
`fs.config.perms_world_readable` finding; that dry-run result is not acceptable live evidence. The
deep audit must run while the dedicated Gateway is healthy so its loopback probe succeeds.

Any exposed Control UI or unrelated HTTP/WebSocket surface, pairing bypass, subprotocol loss,
unstable connection, undocumented/unbounded proxy behavior, audit finding, shared Gateway, or
unminimized snapshot is `no_go`.

## Revocation, shutdown, and privacy

Emergency shutdown order:

1. set Vera's global browser kill switch;
2. disable `VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED`;
3. revoke the dedicated browser-specific Maritime API key;
4. rotate/revoke the extension pairing secret;
5. stop the dedicated Gateway; and
6. confirm the public route no longer accepts WSS connections.

The browser session, cookies, storage, and profile remain inside Chrome and are never uploaded as
credentials. Selected shared-tab content crosses the internet-reachable Gateway boundary, so Vera
minimizes it before returning it. Full snapshots, screenshots, cookies, storage, profile paths, raw
target/node identifiers, marketplace credentials, and page instructions are prohibited in logs,
database records, ordinary evidence, and final release summaries.

The legacy `openclaw.json5` and `node.openclaw.json5` files remain only for regression protection of
the disabled historical current-tab path. They are not the founder remote-extension architecture
and must not be used to provision this spike.
