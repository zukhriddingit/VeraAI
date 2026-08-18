# Vera Browser Connector

Status: accepted founder browser baseline; v2.2.0 one-click enrollment is activation-gated

Reviewed: 2026-08-14

Release profile: `founder_browser_experimental`

Current classification: `private_beta_gated`

## What the founder installs

An approved tester installs Vera Browser Connector BETA v2.2.0 from the private Chrome Web Store
item, or the exact verified unpacked package during pre-publication acceptance. The tester does
**not** install OpenClaw, an OpenClaw node, a CLI, a daemon, Maritime Companion, or a local Vera
agent. No inbound port is opened on the tester's computer.

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
unrelated path. Do not deploy it.

The current `/sbin` bootstrap-compatible replacement is published but is not deployable:

```text
release index:
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec
linux/amd64 runtime child:
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8
source revision:
01bc0adc02808dbaf01089d1464ee8db5fe90593
```

The release index independently passes anonymous pull, the immutable layout and simulated
`/sbin/maritime-init` bootstrap check, a Trivy 0.72.0 zero-finding scan, Cosign verification, SLSA
provenance, and SPDX SBOM verification. `remote-extension-image.json` records the index and child
separately and keeps `deployableBeforeLiveProxyAcceptance: false`. The child must receive its own
verified signature and attestations before the one disposable Maritime acceptance.

A later 2026-08-18 probe against signed Gateway digest
`sha256:467cf214919d9487a95bb3d478bcbdf7e55b7a43137588f07b4bbe1f60befe98`
proved that the image pulls and unpacks, but Maritime still fails before Vera's entrypoint at
`/sbin/maritime-init` when `/sbin` is a relative symlink. The bounded compatibility candidate uses
an empty real `/sbin` directory in addition to the existing empty real `/usr/sbin`; neither is in
the application `PATH`, and neither contains a provider helper in the immutable image. It remains
founder-only and non-deployable until signed-image bootstrap, exact-route WSS, one-tab consent,
revocation, and forbidden-action acceptance all pass.

The repaired container exposes an exact-path filter on public port `18789`. The general OpenClaw
Gateway binds only to loopback port `18790`; the filter forwards raw upgrade bytes only for exact
`/browser/extension` requests and rejects query-bearing or unrelated paths before OpenClaw.
OpenClaw derives its browser-control service as Gateway port plus two, so Vera's read-only snapshot
plugin uses loopback port `18792`. The image explicitly starts that service with OpenClaw's
`OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1` lifecycle flag because a connected extension starts only
the in-process relay runtime, not the HTTP listener. The public filter never exposes the control
service.

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

## One-click enrollment

The tester installs the extension, signs in to Vera, opens **Settings → Browser Connector**, accepts
the read-only disclosure, and clicks **Connect this browser**. The Vera page sees only the extension
version, protocol version, and SHA-256 installation digest. The server issues a 256-bit ticket that
expires within 60 seconds and stores only its digest.

The extension opens the exact assigned `wss://<gateway>/browser/extension` route with protocol
`vera-browser-enrollment.v1` and sends the ticket in one bounded first frame. The Gateway authenticates
the assignment with Vera before reading its fixed mode-`0600` relay credential. Only then does it
return that credential to the extension. The ticket never appears in a URL, header, WebSocket
subprotocol, log, browser page, or persistent database field. The Vera application never resolves or
displays the relay credential.

The connection is remembered in that Chrome profile across browser restarts. Enrollment does not
prepare, attach, group, or share a tab. The tester must separately prepare and share exactly one tab
for every research session. Server revocation disables the device and outstanding tickets before the
response; the authenticated Vera page then tells the extension to clear its local relay credential.

Operators still create the dedicated 64-character lowercase hexadecimal Gateway relay credential
through protected server tooling. Vera's fixed supervisor installs it at
`/data/.openclaw/credentials/browser-extension-relay.secret`, removes the bootstrap seed from parent
and child environments, and fails closed on malformed input, a symbolic link, a non-regular entry,
or an existing mismatch. Never set it to `OPENCLAW_GATEWAY_TOKEN`, print it, or deliver it to a
tester.

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

## Prepared Vera Search tab

The reviewed Vera OpenClaw extension package lives at
`infra/chrome/vera-openclaw-extension`. It preserves the reviewed OpenClaw relay protocol, adds the
bounded Vera enrollment handoff, and changes when Chrome's debugger lease is acquired.

Choose **Prepare Vera Search tab** before starting browser research or a screen recording. The
extension creates one blank consented tab, attaches while no third-party page or extension frame is
present, and only then navigates to the fixed reviewed rental bootstrap URL. The popup must show
**Browser ready** before Vera enables browser sources.

This is a general compatibility boundary for recorders, accessibility tools, password managers,
and other extension overlays. Vera never inspects or disables another extension. If Chrome refuses
or later terminates the debugger lease, the popup reports a sanitized browser/debugger conflict,
Vera keeps completed source results, and the user can prepare a clean replacement tab. Preparing a
replacement unshares the previous tab without closing or navigating it.

Load the directory as an unpacked extension only after this check passes:

```sh
pnpm verify:vera-openclaw-extension
```

The readiness bridge runs only on the reviewed Vera application origins and publishes the extension
version, enrollment protocol version, SHA-256 installation digest, connection state, shared-tab
count, and typed readiness state. It publishes no URLs, tab titles, page content, cookies, relay
credentials, raw installation identifier, or raw Chrome errors.

Configured housing sources use the same prepared single tab and signed bounded tool. BU Off-Campus
is a registry entry for the reusable Off Campus Partners adapter. A custom website supplies one
public HTTPS starting URL and one exact allowed domain; the Gateway never accepts model-generated
URLs, selectors, JavaScript, form submission, or cross-domain navigation. Generic discovery is
limited to ten observed cards, two scrolls, and three observed same-domain details. When repeated
cards are not recognized, Vera exposes a navigation-free **Capture current listing page** fallback.
Craigslist is founder-only, user-triggered, limited to ten housing results and five observed detail
URLs, and keeps Reply, relay email, phone, posting, payment, upload, and download controls forbidden.

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
