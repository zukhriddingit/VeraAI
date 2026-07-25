# Founder browser remote-extension connectivity spike

**Status:** Approved for implementation on 2026-07-25

## Goal

Add a founder-only connectivity spike for the official OpenClaw Chrome extension topology:

```text
authenticated Vera founder
  -> dedicated Maritime-hosted OpenClaw Gateway
  <- direct outbound WSS from the OpenClaw Chrome extension
  -> one explicitly shared OpenClaw tab-group tab
  -> one deterministic read-only snapshot request
  -> minimized result returned to Vera
```

The founder installs only the Chrome extension. The founder does not install OpenClaw, an
OpenClaw node, a CLI, a local daemon, Maritime Companion, or a local Vera agent.

This slice proves connectivity and consent only. It does not discover listings, navigate, type,
click, submit forms, message, upload, download, apply, pay, schedule monitoring, or automate
marketplace login.

## Verified upstream floor

OpenClaw `2026.7.1` is the first release whose release notes and bundled extension documentation
include direct remote-Gateway pairing with:

```sh
openclaw browser extension pair --gateway-url wss://gateway.example
```

The extension connects to `/browser/extension` using two WebSocket subprotocol values: the fixed
relay protocol and a host-local pairing credential. The pairing credential remains in the pairing
string fragment at rest and is sent in `Sec-WebSocket-Protocol`, not in the request URL. The route
also checks for a `chrome-extension://` origin, rejects query-string credentials, and accepts only
profiles using the extension driver.

The older Vera pin `2026.6.33` predates this topology and must not be used for this spike. The new
gateway image is pinned independently to:

```text
ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c
```

That is the multi-platform digest for the official `2026.7.1` image. The existing `2026.6.33`
configuration remains unchanged for the legacy, disabled local-node design until that design is
retired separately.

## Isolation

The spike uses a new dedicated Maritime agent and OpenClaw state directory. It must not reuse the
RentCast analysis agent, the Vera worker agent, another renter's gateway, a gateway pairing secret,
or a Maritime runtime key.

For the founder slice, the authenticated founder UUID is bound to exactly one:

- Maritime browser-gateway agent ID;
- server-only Maritime API key;
- OpenClaw gateway authentication credential;
- OpenClaw extension pairing secret; and
- isolated OpenClaw state volume.

The first slice supports one founder. A future multi-user implementation must provision one
gateway and credential set per Vera user before activation; it may not introduce a shared gateway
lookup fallback.

## Public ingress

The extension endpoint is internet reachable. The only intended public application route is:

```text
wss://<dedicated-gateway-host>/browser/extension
```

The public proxy must:

- negotiate an HTTP WebSocket upgrade over TLS;
- preserve both `Sec-WebSocket-Protocol` values end to end;
- forward the exact `/browser/extension` route;
- reject every unrelated HTTP and WebSocket route;
- remain connected for the bounded stability test;
- enforce documented request, frame, response, idle, and upstream timeouts; and
- avoid logging URL fragments, pairing credentials, authorization values, or frames.

OpenClaw `2026.7.1` bounds extension relay frames to 64 MiB. Vera independently bounds its
snapshot request and minimized response much lower. This upstream limit does not prove Maritime's
proxy limit or connection behavior.

Maritime's current public documentation describes a public HTTPS URL and an exposed port but does
not document WebSocket upgrades, WSS, subprotocol preservation, path filtering, proxy size limits,
idle timeouts, or connection stability. Therefore those properties require an opt-in live probe
against the dedicated gateway. Missing proof is a blocker, not a configuration assumption.

## Gateway hardening

The dedicated configuration:

- disables the Control UI, terminal, canvas, A2UI, channels, cron, ACP, commands, updates, web
  search, web fetch, exec, filesystem, messaging, sessions, nodes, and model HTTP endpoints;
- enables only the bundled browser plugin and Vera's snapshot-only plugin;
- configures one `chrome` extension-driver profile;
- disables browser evaluation;
- exposes no local-node routing;
- requires gateway token authentication for non-extension Gateway surfaces;
- retains extension pairing-secret authentication on `/browser/extension`;
- uses no automatic pairing approval; and
- denies the built-in `browser` tool to the model.

The Vera plugin registers one agent tool with an empty input schema. It talks only to the
loopback browser-control service, requires exactly one shared tab, requests an AI snapshot for the
fixed `chrome` profile, and cannot accept a URL, target ID, selector, action, text, file path, or
other browser instruction from the model.

The plugin minimizes the snapshot before the model receives it. The returned object contains only
a sanitized URL without query or fragment, a sanitized title, bounded sanitized text lines, source
and result hashes, truncation state, and safe counts. It omits raw target IDs, refs, form values,
cookies, storage, profile paths, screenshots, full snapshots, downloads, and raw CDP messages.

## Vera request boundary

Vera uses a browser-specific Maritime API key and agent ID:

```text
MARITIME_BROWSER_GATEWAY_API_KEY
MARITIME_BROWSER_GATEWAY_AGENT_ID
VERA_BROWSER_GATEWAY_FOUNDER_USER_ID
VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED
```

These are server-only values and never use a `NEXT_PUBLIC_` prefix. They are separate from
`MARITIME_API_KEY` and `MARITIME_OPENCLAW_AGENT_ID`, which continue to serve the existing RentCast
analysis path.

An authenticated founder explicitly confirms that one intended tab is in the OpenClaw tab group
and requests a snapshot. Vera sends a fixed, input-free task to the dedicated Maritime agent. The
agent can invoke only the snapshot-only tool and must return its strict JSON result. Vera validates
the closed schema and byte limit before displaying it. Invalid, oversized, stale, mismatched, or
non-JSON output fails closed.

The LLM is a router, not the browser policy boundary. Tool registration, empty input, fixed profile,
exactly-one-shared-tab enforcement, the browser-tool deny rule, deterministic minimization, and
Vera's schema validation enforce the slice.

## Product and release boundaries

The existing RentCast plus Maritime OpenClaw live-search path is unchanged.

`founder_core` remains browser-disabled and its browser-disabled evidence phases remain mandatory.
This spike cannot satisfy a founder-core phase and does not change its classification rules.

`founder_browser_experimental` remains release-ineligible and `no_go`. The approved architecture
replaces ADR 0012's local-node option, but release eligibility does not change until all of the
following private live evidence exists:

- exact OpenClaw image digest and effective configuration;
- successful direct extension pairing over WSS;
- subprotocol preservation;
- unrelated-route denial;
- stable bounded connection;
- proxy payload and timeout observations;
- one successful minimized read-only snapshot;
- revocation and gateway shutdown;
- plain `openclaw security audit`; and
- `openclaw security audit --deep`.

No result from this connectivity spike authorizes Zillow, Apartments.com, Facebook Marketplace, or
any other discovery connector.

## Failure handling

The request returns safe states such as disabled, forbidden, not configured, pairing required, no
shared tab, multiple shared tabs, gateway unavailable, snapshot timed out, oversized result,
invalid result, or policy denied. Logs and audit events contain only request IDs, hashes, state
codes, timings, and opaque deployment references.

Removing the tab from the OpenClaw tab group revokes access immediately. Emergency shutdown first
sets Vera's global browser kill switch, then disables the remote snapshot flag, revokes the
browser-specific Maritime key, rotates the extension pairing secret, and stops the dedicated
gateway. No evidence or documentation may instruct an operator to reuse the legacy live-search
agent as the browser gateway.

## Validation

Automated tests cover:

- exact version and immutable image pin;
- dedicated environment variables and founder binding;
- disabled-by-default behavior;
- strict empty plugin input;
- exactly one shared tab;
- fixed extension profile;
- GET-only browser-control calls;
- snapshot and minimized-response byte limits;
- URL query/fragment removal;
- secret, email, phone, form-value, raw-ID, and profile-path removal;
- invalid Maritime output rejection;
- no fallback to the RentCast agent;
- no navigation or browser action strings in the plugin;
- Control UI and unnecessary Gateway surfaces disabled;
- opt-in WSS probe parsing and secret-safe output;
- unchanged founder-core requirements; and
- unchanged browser-experimental `no_go` release eligibility.

The live probe and security audits produce private external evidence. They are never ordinary unit
tests and never place pairing credentials or full snapshots in Git.
