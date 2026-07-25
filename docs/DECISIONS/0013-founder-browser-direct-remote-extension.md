# ADR 0013: Founder browser direct remote extension

Status: accepted for connectivity spike; live acceptance pending

Date: 2026-07-25

Supersedes: ADR 0012 for the `founder_browser_experimental` target architecture only

## Context

ADR 0012 rejected an undocumented Maritime-to-local-node ingress design. OpenClaw `2026.7.1`
subsequently introduced the documented direct remote-Gateway extension topology. The founder can
install the official Chrome extension, place selected tabs in the OpenClaw tab group, and connect
outbound over WSS to `/browser/extension` without installing OpenClaw, a node, a CLI, a daemon,
Maritime Companion, or a local Vera agent.

The OpenClaw route authenticates a host-local pairing secret from
`Sec-WebSocket-Protocol`, rejects query-string credentials, checks the Chrome-extension origin,
and preserves the tab group as the consent boundary.

Maritime documents public HTTPS port exposure, but does not document WebSocket upgrades,
`Sec-WebSocket-Protocol` preservation, route filtering, payload limits, idle timeouts, or
connection stability. Those properties cannot be assumed from the HTTPS feature.

## Decision

Adopt the direct remote extension topology for a founder-only connectivity spike:

```text
authenticated founder
  -> Vera server
  -> dedicated per-founder Maritime OpenClaw Gateway
  <- outbound WSS from official OpenClaw Chrome extension
  <- exactly one tab explicitly placed in the OpenClaw tab group
  -> deterministic snapshot-only Vera plugin
  -> minimized schema-validated result
```

Use OpenClaw `2026.7.1` or a separately reviewed later release. The initial immutable image is:

```text
ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c
```

The existing RentCast analysis agent and `2026.6.33` legacy local-node configuration remain
separate and unchanged.

Each Vera user requires an isolated Gateway, state volume, extension pairing secret, Gateway
credential, Maritime agent ID, and server runtime key. A Gateway may not be shared between
unrelated renters.

The public surface must expose only the extension route. The Control UI, Canvas, A2UI, model HTTP
endpoints, tools HTTP endpoint, main Gateway WebSocket, terminal, channels, cron, ACP, commands,
nodes, and all unrelated routes remain unavailable or denied.

The built-in browser tool is denied to the model. A Vera plugin exposes one empty-input tool. It
uses only GET requests against the fixed loopback `chrome` profile, requires exactly one shared
tab, requests one bounded snapshot, and minimizes it before returning. It accepts no URL, target,
selector, action, text, or file parameter.

## Live acceptance

This ADR accepts the architecture, not Maritime's unverified proxy behavior. Before the spike is
accepted as connected, private evidence must prove:

1. WSS and WebSocket upgrade success on the exact route.
2. Preservation of both extension subprotocol values.
3. Pairing-secret enforcement and wrong-secret denial.
4. Denial of every unrelated HTTP and WebSocket route.
5. Bounded connection stability, payload behavior, and timeouts.
6. One explicitly shared tab and one minimized read-only snapshot.
7. Pairing-secret rotation, tab revocation, and Gateway shutdown.
8. `openclaw security audit`.
9. `openclaw security audit --deep`.

Failed or missing proof remains a code/security/live-validation blocker as applicable. It is not
converted to N/A or silently skipped.

## Consequences

- `founder_core` is unchanged and continues to require positive proof that browser execution is
  disabled.
- `founder_browser_experimental` remains release-ineligible and `no_go`.
- No marketplace discovery implementation may begin until the connectivity and security evidence
  above passes.
- The public endpoint is treated as internet reachable even if its hostname is unguessable.
- Full snapshots, screenshots, raw target/profile IDs, cookies, storage, and pairing credentials
  do not enter Vera, Git, logs, or committed evidence.
- Removing a tab from the OpenClaw tab group is immediate user revocation.
