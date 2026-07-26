# Vera Browser Connector

Status: founder connectivity spike; local route-isolation repair awaits image publication

Reviewed: 2026-07-25

Release profile: `founder_browser_experimental`

Current classification: `no_go`

## What the founder installs

The founder installs one unpacked Chrome extension: the official OpenClaw Chrome extension from the
exact reviewed OpenClaw `2026.7.1` image. The founder does **not** install OpenClaw, an OpenClaw
node, a CLI, a daemon, Maritime Companion, or a local Vera agent. No inbound port is opened on the
founder's computer.

The extension is necessary because Chrome does not expose an authenticated consumer session to a
remote server by default. It uses Chrome's extension APIs and makes one outbound WSS connection to
the founder's dedicated Gateway. It does not give Vera browser-history, password-manager,
downloads, extension-page, settings-page, developer-tools, or unrelated-tab access.

OpenClaw `2026.7.1` is the first reviewed release containing PR `#101127`, which adds direct Chrome
extension pairing to a remote Gateway. It supports the `/browser/extension` route, WSS pairing,
`Sec-WebSocket-Protocol` authentication, the `OpenClaw` tab-group consent boundary, and
`driver: "extension"` browser profiles. Vera's older `2026.6.33` RentCast analysis pin does not
satisfy this contract and remains isolated from the browser path.

Reviewed upstream references:

- [OpenClaw Chrome extension](https://docs.openclaw.ai/tools/chrome-extension)
- [OpenClaw Gateway security](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md)
- [Maritime configuration](https://maritime.sh/docs/configuration)
- [Maritime provisioning API](https://maritime.sh/docs/api/provisioning)

## Direct WSS topology

```text
authenticated founder
  -> Vera web
  -> founder-owned browser-connection record
  -> dedicated per-user OpenClaw Gateway on Maritime
  <- outbound WSS from the official Chrome extension
  <- exactly one tab explicitly placed in the OpenClaw tab group
  -> vera_read_shared_tab_snapshot
  -> minimized, schema-validated result
  -> Vera activity event
```

The rejected R1 artifact is:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:a19542d467b81b7f1ae3bafb48952e3fdf9ddc6c324c97820680bd39be2a3b1c
```

Its OCI source revision is:

```text
ea95c6a2a92d12625b3db0d71f45823cf7c28b8e
```

R2 Test A retained that identity only as evidence of the failed baseline. The artifact accepts the
authenticated extension route, but its generic OpenClaw Gateway WebSocket also upgrades an
unrelated path. Do not deploy it. The route-isolation repair has no published replacement image;
`remote-extension-image.json` therefore remains `pending` with `image: null`.

The repaired container exposes an exact-path filter on public port `18789`. The general OpenClaw
Gateway binds only to loopback port `18790`; the filter forwards raw upgrade bytes only for exact
`/browser/extension` requests and rejects query-bearing or unrelated paths before OpenClaw.
OpenClaw derives its browser-control service as Gateway port plus two, so Vera's read-only snapshot
plugin uses loopback port `18792`; the public filter never exposes that control service.

The Gateway is an internet-reachable trust boundary even when its hostname is unguessable. One
Gateway, state volume, Gateway token, extension pairing secret, Maritime agent ID, and
browser-specific Vera API credential belong to exactly one Vera user. A Gateway must never be
shared between unrelated renters.

Production persistence may record only:

- Vera user ID;
- Maritime agent ID;
- OpenClaw deployment identity and exact image digest;
- safe Gateway hostname;
- pairing state, never the pairing secret;
- extension state and paired-browser display name;
- shared-tab count;
- last heartbeat and last successful minimized snapshot time;
- disabled and revoked timestamps.

Normal application tables must not store a raw Gateway token, extension pairing secret, browser
cookie, local/session storage, password, browser history, full tab inventory, full snapshot, raw
target/profile identifier, or unrelated-tab metadata.

## Pairing

An authorized operator creates the dedicated Gateway credential in protected server tooling. The
operator runs the official OpenClaw pairing command inside that user's Gateway:

```sh
maritime exec <dedicated-browser-agent> \
  -- \
  openclaw browser extension pair \
  --gateway-url 'wss://api.maritime.sh/a/<opaque-agent-id>'
```

The command emits
`wss://api.maritime.sh/a/<opaque-agent-id>/browser/extension#<secret>`. The fragment must be handed
directly to the correct founder through an approved secret channel. Do not paste it into Codex,
GitHub, logs, analytics, screenshots, tickets, ordinary release evidence, or a query string.

The founder:

1. receives the unpacked extension directory extracted from the exact reviewed image;
2. opens `chrome://extensions`;
3. enables Developer mode and chooses **Load unpacked**;
4. selects that extension directory;
5. opens the extension popup and pastes the one-user pairing string; and
6. confirms that the extension reports connected to the expected safe hostname.

The pairing secret is a host-local credential carried in the WebSocket subprotocol, not an operator
token shared with the browser. Rotate it after suspected disclosure, revoke it when the connection
is disabled, and remove the dedicated Gateway during user deletion.

Vera must display:

> Vera can only read and control tabs you explicitly share through the Browser Connector.

## Consent and the founder snapshot

Only tabs in the Chrome tab group named `OpenClaw` are shared. The founder adds one intended tab to
that group before capture and removes it to revoke access immediately. Vera requires exactly one
shared tab and a fresh user confirmation.

The connectivity spike permits one read-only snapshot from one exact allowlisted HTTPS hostname.
It permits no navigation, click, typing, form access, upload, download, screenshot, message,
application, payment, or additional page. The model cannot call OpenClaw's built-in browser tool.
The only model-visible tool is `vera_read_shared_tab_snapshot`, which accepts an empty object.

The tool:

- reads only fixed loopback `GET /tabs` and `GET /snapshot` routes for profile `chrome`;
- rejects zero or multiple shared tabs;
- rejects HTTP and off-allowlist origins;
- bounds tab inventory at 64 KiB and the raw accessibility snapshot at 128 KiB;
- limits source text to 32,768 characters;
- returns at most 24 sanitized lines and 2,400 characters;
- strips query strings, paths, contacts, secrets, raw target/profile IDs, cookies, and storage;
- times out after five seconds at the browser boundary;
- treats page text as untrusted data; and
- returns hashes, safe counts, capture time, correlation ID, and the page origin only.

Page text cannot change the task, request another tool, expand the hostname, request secrets, cause
navigation or messaging, alter policy, or trigger another page.

## Connection states and offline behavior

The application state machine distinguishes:

- `not_provisioned`;
- `gateway_provisioning`;
- `gateway_ready`;
- `pairing_pending`;
- `extension_connected`;
- `extension_disconnected`;
- `no_shared_tab`;
- `shared_tab_ready`;
- `snapshot_running`;
- `snapshot_completed`;
- `login_required`;
- `two_factor_required`;
- `captcha_required`;
- `consent_required`;
- `policy_blocked`;
- `gateway_unavailable`;
- `version_incompatible`; and
- `revoked`.

A missing, disconnected, interrupted, or restarted Gateway/extension returns a typed safe failure.
It is never an empty successful search and never creates a `RawListing`. Manual login, 2FA,
CAPTCHA, and consent remain founder actions.

## Kill switches and revocation

The global browser kill switch and the user's browser capability must both be enabled before a
snapshot. Failure at either layer denies before dispatch. Production remains disabled at rest.

Emergency shutdown order:

1. enable Vera's global browser kill switch;
2. disable the user's browser capability;
3. disable `VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED`;
4. revoke the dedicated `MARITIME_BROWSER_GATEWAY_API_KEY`;
5. rotate/remove the extension pairing secret;
6. stop the dedicated Gateway;
7. verify that WSS no longer connects; and
8. delete the disposable Gateway and its volume when evidence collection ends.

Removing the tab from the `OpenClaw` group revokes tab access. Revoking a user must not affect
another user's isolated Gateway.

## Exact founder live-test procedure

All real outputs belong under `release-evidence/private/`, mode `0700`; individual evidence files
must be mode `0600`. Do not commit real hostnames, agent IDs, pairing strings, raw audits, tab
content, screenshots, or snapshots. Copy the completed sanitized evidence bundle to a restricted
private artifact store under the documented retention/deletion policy.

Prerequisites:

1. obtain separate explicit approval to publish the repaired internet-facing image;
2. record the resulting immutable digest and exact R2 source commit in
   `remote-extension-image.json`;
3. rerun local Test A against that digest and require exact-route-only exposure;
4. only then obtain approval for one disposable `custom`, always-on Maritime agent with public port
   `18789`; and
5. generate a unique `OPENCLAW_GATEWAY_TOKEN` without printing it and store it as a secret on that
   agent.

There is deliberately no deploy command while the replacement image has not been published.

Acceptance order:

1. verify the config is mode `0600`, the state directory is mode `0700`, OpenClaw reports
   `2026.7.1`, only `browser` and `vera-read-shared-tab` plugins are loaded, and Control UI/model
   HTTP/terminal/node surfaces remain disabled; the hardened entrypoint must repair only the fixed
   state boundary and drop provider-overridden root before OpenClaw starts;
2. run `openclaw security audit`;
3. seed the container-local audit identity with only `operator.read`, run
   `openclaw security audit --deep`, and remove that audit identity;
4. generate a new official remote pairing value without logging it;
5. run the opt-in proxy smoke against the exact
   `wss://api.maritime.sh/a/<opaque-agent-id>/browser/extension` route from restricted tooling;
6. require unrelated-route denial, wrong-secret denial, successful WebSocket upgrade, preserved
   `openclaw-extension-relay` subprotocol, a bounded stable connection, clean client close, and
   successful reconnect;
7. install and pair the official extension, then confirm cross-user/wrong-Gateway pairing cannot
   satisfy the user's Vera connection;
8. share exactly one allowlisted HTTPS tab and capture one minimized read-only snapshot;
9. confirm disconnect, tab removal, both kill switches, pairing rotation, and replay rejection;
10. stop the Gateway and confirm WSS no longer connects;
11. delete the disposable agent and confirm it is absent; and
12. validate/hash the sanitized private evidence bundle.

The repository probe is opt-in:

```sh
VERA_REMOTE_EXTENSION_PROXY_SMOKE=1 \
OPENCLAW_EXTENSION_GATEWAY_URL='wss://<dedicated-hostname>/browser/extension' \
OPENCLAW_EXTENSION_PAIRING_SECRET='<load-from-private-secret-store>' \
pnpm test:staging:remote-extension-proxy
```

The secret must be injected by protected tooling, not typed into shell history. The report contains
no hostname or secret.

## Evidence and release decision

Required private evidence covers WSS upgrade, `Sec-WebSocket-Protocol`, wrong-secret denial,
unrelated-route denial, bounded stability, reconnect, official extension pairing, cross-user
rejection, exactly one shared tab, minimized snapshot, disconnect, both kill switches, pairing
rotation/replay denial, shutdown, both OpenClaw audits, exact source commit, exact image digest, and
agent deletion.

The public proxy's provider payload limit and idle timeout require separate provider evidence; a
short smoke test cannot infer them. Missing or failed evidence remains a mandatory failure, never
N/A.

`founder_core` is unchanged and continues to require positive browser-disabled proof. The browser
profile stays `no_go` under `remote_extension_live_acceptance_pending` until every mandatory live
phase passes. It can never classify a browser-enabled multi-user beta as released.

## 2026-07-25 R1 and R2 transport result

One explicitly approved disposable Gateway was deployed from the recorded immutable image digest.
Plain HTTPS reached the exact prefixed extension route and returned OpenClaw's expected `426
Upgrade Required`. WebSocket controls then failed before OpenClaw pairing authentication:

- an unrelated route was denied;
- a wrong pairing secret was denied;
- a Chrome-extension Origin with no pairing secret returned `403`, not OpenClaw's expected `401`;
- the correct official 64-character OpenClaw pairing secret also returned `403`; and
- no `101 Switching Protocols` or selected `openclaw-extension-relay` subprotocol was observed.

R2 then tested the exact same immutable image behind local TLS without Maritime. The intended route
behaved correctly: no and wrong pairing credentials returned `401`, an invalid Origin returned
`403`, and the correct official pairing protocol opened with `101`, selected
`openclaw-extension-relay`, and remained stable for five seconds. However, an unrelated WebSocket
path also opened with `101`. Upstream source confirms that the browser plugin declines unrelated
paths and OpenClaw's generic Gateway handler then accepts the upgrade.

The first divergent boundary is therefore the R1 image's public route isolation, not a proven
Maritime-only defect. Tests B through D were not run. A local repair now puts an exact-path filter
on `18789`, the generic Gateway on loopback port `18790`, and the derived browser-control client on
loopback port `18792`; focused tests pass, but the replacement image has not been published or
accepted. The spike remains `no_go`; no source browsing, shared-tab capture, or Milestone 13B work
is authorized.

## Hosted-browser future option

A future hosted browser may remove the founder extension requirement, but it would create a
different credential, isolation, retention, and website-policy boundary. It requires a separate ADR,
threat model, source review, and release profile. This spike does not authorize hosted browser
profiles, multi-site discovery, background monitoring, or autonomous actions.
