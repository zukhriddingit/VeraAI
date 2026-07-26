# Milestone 13A-R2 Transport Root-Cause and Repair

**Status:** Approved for implementation on 2026-07-25

## Goal

Identify the exact layer that prevents the official OpenClaw Chrome extension from completing its
direct WSS handshake with the dedicated Maritime-hosted Gateway, repair only that layer, and rerun
the founder-only read-only connectivity acceptance.

This work does not implement Milestone 13B, source discovery, hosted browsing, navigation, typing,
messaging, forms, downloads, uploads, applications, payments, or marketplace adapters.

## Authoritative baseline

All repository work runs from the isolated clean worktree:

```text
/private/tmp/vera-founder-staging-evidence-pr
```

The authoritative branch and initial R2 HEAD are:

```text
codex/founder-browser-remote-extension
e4b2c8d10eb26ab415267dbf53898fe258d5dfbc
```

The older desktop workspace is outside scope. No command may switch, clean, reset, stash, inspect,
or copy data from it.

R2 uses release/test identifier `m13a-r2-20260725-01`. It writes only new files beneath the
gitignored `release-evidence/private/` directory, which remains mode `0700`; evidence files remain
mode `0600`.

The R1 evidence bundle is immutable:

```text
path: release-evidence/private/m13a-release-evidence-bundle-final.json
file SHA-256: 6d07a38907bcc8b543ccab39b88105df165b6b53af54938a058bdf98fc01f011
canonical bundle SHA-256: 062c65088bd71a1191982bbe75eb75d1a4ce94a59eb780045bbf680a410c3575
```

R2 records these hashes before testing and verifies them again during final cleanup.

## Fixed artifact identities

R2 begins with the already-public immutable Gateway image:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:a19542d467b81b7f1ae3bafb48952e3fdf9ddc6c324c97820680bd39be2a3b1c
```

It is bound to Vera source commit:

```text
ea95c6a2a92d12625b3db0d71f45823cf7c28b8e
```

The image contains:

- OpenClaw `2026.7.1`;
- the official Manifest V3 OpenClaw Chrome extension version `2.0.0`;
- extension source `/app/dist/extensions/browser/chrome-extension`;
- Maritime CLI `1.7.0` on the operator host; and
- Gateway port `18789`.

The public remote route is served on the Gateway listener at `/browser/extension`. OpenClaw first
authenticates the Chrome-extension Origin and the two offered WebSocket subprotocol values, then
bridges the accepted socket to the per-profile loopback extension relay. The loopback relay port is
an implementation detail derived from the browser-control port and is not the public endpoint.

## Selected approach

Use a layered differential matrix against the exact immutable image:

```text
Test A: temporary Chrome -> local TLS reverse proxy -> exact Gateway image
Test B: container-internal client -> Maritime ingress shim -> exact Gateway image
Test C: harmless generic WebSocket client -> Maritime edge -> diagnostic service
Test D: temporary Chrome -> Maritime edge -> exact Gateway image
```

Each test proves one boundary before the next begins. A later failure cannot erase an earlier
passing result. No broad `failed_provider` classification is allowed until Tests A through C locate
the failing layer.

## Protocol contract

For OpenClaw `2026.7.1`, the remote extension contract is:

- public path: `/browser/extension`;
- accepted request Origin: empty for non-browser diagnostics or
  `chrome-extension://<reviewed-extension-id>` for Chrome;
- offered protocol count: two for the real extension;
- non-secret protocol: `openclaw-extension-relay`;
- credential-bearing protocol: never logged; only its SHA-256 is retained;
- wrong or missing pairing credential: `401` after a valid Origin reaches OpenClaw;
- invalid Origin: `403`;
- successful response: HTTP `101` selecting `openclaw-extension-relay`; and
- maximum upstream relay frame: `67,108,864` bytes, while Vera probes remain far smaller.

The remote route is registered on the Gateway HTTP upgrade listener. It is not the loopback
`/extension` route and it is not the CDP port.

## Test A: exact image without Maritime

Create a disposable Docker network containing:

1. the exact immutable Gateway image;
2. a standards-compliant local TLS reverse proxy; and
3. no other Vera or Maritime service.

Use a fresh temporary Chrome profile with only the exact bundled extension loaded. Do not attach to
the founder's ordinary Chrome profile. Create one blank local test page, explicitly place only that
tab in the OpenClaw tab group, and retain no page content after the test.

The matrix verifies:

- direct container-internal HTTP upgrade;
- WSS through the local TLS proxy;
- exact `/browser/extension` routing;
- correct-Origin acceptance;
- wrong-secret denial;
- correct HTTP `101`;
- selected `openclaw-extension-relay` response protocol;
- a stable bounded connection;
- extension connection state;
- exactly one explicitly shared blank/test tab;
- one minimized read-only snapshot; and
- immediate loss of access after tab removal.

If Test A fails, Maritime testing stops. The failing image, OpenClaw, extension, pairing, local
proxy, bind, port, or route configuration is repaired locally with a regression test. No replacement
image is published without separate approval.

## Test B: Maritime container-internal path

Provision one disposable, public, always-on Maritime agent from the exact immutable image. Set the
public configured port explicitly rather than relying on the default.

Inside the agent, collect only sanitized facts:

- effective configured `PORT`;
- listening addresses and ports;
- provider ingress-shim process arguments;
- Gateway process identity and port;
- health of both processes;
- the result of an upgrade directly to Gateway port `18789`;
- the result of an upgrade through the provider ingress shim;
- received path classification: exact, prefixed, redirected, or normalized;
- Origin presence as a boolean and Origin scheme only;
- protocol count;
- presence of `openclaw-extension-relay`;
- SHA-256 of the credential-bearing protocol; and
- whether a request reached OpenClaw.

No raw pairing token, full header set, agent ID, public URL, or secret-bearing subprotocol enters
logs or committed evidence.

## Test C: Maritime edge capability matrix

Use a second disposable agent in the same tier, exposure mode, hostname style, and configured-port
shape. The diagnostic service reports a closed, redacted schema and supports:

- configurable accepted path;
- Origin scheme and presence reporting;
- multiple offered protocols;
- explicit harmless response protocol selection;
- ping/pong;
- bounded echo; and
- a bounded idle timer.

Prefer running the diagnostic process from the existing approved public image without publishing a
new artifact. If Maritime cannot expose that process without a separately deployable image, stop
before publishing and request explicit approval for a new public diagnostic image. A private image
may be used only if Maritime can pull it without exposing registry credentials.

The external matrix covers:

1. no protocol;
2. one harmless protocol;
3. two harmless protocols;
4. the non-secret OpenClaw protocol shape;
5. the real `chrome-extension://` Origin scheme;
6. `/browser/extension`;
7. the provider `/a/<opaque-agent>` prefix;
8. bounded idle stability;
9. ping/pong;
10. a bounded snapshot-control-sized payload;
11. invalid Origin; and
12. invalid path.

For every case, retain only status, selected harmless protocol, lifetime, close code, bounded sizes,
sanitized provider correlation reference, and whether the request reached the container.

## Test D: final real extension retry

Run Test D only after the exact failing layer is repaired. Provision a fresh disposable always-on
Gateway from the approved immutable image unless Test A proved that a replacement image is required
and its publication was separately approved.

Use a new official pairing string and the exact reviewed extension in the disposable Chrome
profile. Verify:

- unrelated-route denial;
- wrong-secret denial;
- correct `101`;
- expected selected protocol;
- stable connection;
- any required device approval;
- exactly one explicitly shared tab;
- one minimized read-only snapshot;
- no interaction beyond snapshot;
- immediate tab-removal revocation;
- pairing revocation;
- shallow and deep security audits; and
- Gateway deletion.

## Classification rules

- Test A failure: image, OpenClaw, extension, or configuration defect.
- Test A pass plus Test B failure: Vera/Maritime container port or ingress-shim defect.
- Tests A and B pass plus generic Test C failure: Maritime edge/proxy defect.
- Generic Test C pass plus real OpenClaw failure: OpenClaw route, Origin, protocol shape, path
  rewrite, or Gateway configuration defect.
- Upgrade pass plus stability failure: idle timeout, sleep/wake, ping/pong, or tier defect.

The smallest fix is selected in this order:

1. configured Maritime port;
2. ingress-shim bind address;
3. Gateway target port;
4. accidental relay-port forwarding;
5. exact path rewrite;
6. upgrade-header preservation;
7. selected response protocol;
8. redirect removal;
9. documented bounded limits;
10. always-on execution; and
11. separately tested dedicated/custom-domain ingress.

Origin checks, pairing, protocol authentication, fixed route isolation, and the official OpenClaw
protocol are never weakened.

## Evidence and privacy

R2 records:

- exact source, image, OpenClaw, extension, CLI, and time identities;
- protocol counts and non-secret names;
- SHA-256 of the credential-bearing protocol;
- sanitized matrix outcomes;
- security-audit summaries;
- cleanup outcomes; and
- canonical record and bundle hashes.

Real endpoints, agent IDs, pairing strings, tokens, full headers, browser content, target IDs,
profile paths, screenshots, and raw audits remain only in restricted private artifacts when
strictly required. Credential files are removed after revocation. The R2 bundle never overwrites the
R1 bundle.

## Completion

Milestone 13A passes only if Test D pairs the official extension through Maritime and returns one
minimized snapshot from one explicitly shared blank/test tab. Any remaining failure keeps
`founder_browser_experimental=no_go`, leaves Milestone 13B unauthorized, and names the smallest
remaining repair.
