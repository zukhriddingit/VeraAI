# ADR 0012: Founder-staging OpenClaw ingress

Status: accepted

Date: 2026-07-23

## Context

The founder-controlled browser node needs a supported TLS/WSS path to an OpenClaw gateway. Vera must
not invent private Maritime networking, expose a gateway simply because a URL is difficult to guess,
or run a networking daemon without a supported runtime contract. Current Maritime documentation
describes `--public` as a public, no-login web URL and the OpenClaw guide describes direct hosting of
the gateway; it does not document an authenticated, allowlisted private WSS ingress or supported
tailnet/SSH participation for a Maritime runtime. [Maritime configuration](https://maritime.sh/docs/configuration)
and [Maritime OpenClaw guide](https://maritime.sh/docs/frameworks/openclaw) therefore do not establish
an acceptable transport.

OpenClaw itself supports direct WS/WSS remote transport and its gateway has token/password or trusted
proxy authentication modes, but it treats a gateway and its paired nodes as one operator trust domain.
That capability does not supply the missing Maritime exposure design. [OpenClaw gateway configuration](https://github.com/openclaw/openclaw/blob/main/docs/gateway/configuration-reference.md)
and [OpenClaw security model](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md)
confirm the residual trust boundary.

## Decision

Select **option C**: browser capture remains disabled in Maritime founder staging. Non-browser
Maritime worker jobs can be staged under the explicit `founder_core` release profile. That profile
does not mark browser-live requirements N/A; it replaces them before evaluation with mandatory
positive proof that browser capture, dispatch, ingress, scheduling, and activation are disabled.

The separate `founder_browser_experimental` profile retains all browser-live phases and remains
release-ineligible with `openclaw_ingress_adr_unresolved`. An arbitrary evidence record cannot
override that profile-level blocker.

| Boundary | Founder-staging decision |
| --- | --- |
| Gateway | No Vera OpenClaw gateway is deployed or adopted for browser staging. |
| Node | The founder-controlled node/profile remains local and manually operated; it makes no staging connection. |
| WebSocket/TLS | No WSS connection is established. A future design must document the TLS terminator, certificate ownership, endpoint allowlist, and replay/pairing behavior. |
| Authentication | No gateway token or node pairing is created for this stage. A future route must use reviewed authentication and explicit founder-only authorization. |
| Exposure | No `--public`, public/no-login endpoint, guessed-private URL, or undocumented container network is approved. |
| Failure behavior | Browser jobs defer visibly; no raw listing, source-cursor advance, or success event is created. |
| Shutdown | Keep browser/source kill switches disabled and do not start, pair, restart, or deploy browser infrastructure. |

## Consequences

- Vera can produce `conditional_go_founder_only_staging` or `go_founder_only_core_beta` only for
  `founder_core` after all mandatory core and browser-disabled phases satisfy the release gate.
- The unresolved ingress decision does not block `founder_core`.
- Gmail read-only ingestion, calendar evidence, PostgreSQL recovery, notification, and worker paths
  remain eligible for isolated staging evidence.
- The gateway, node, WSS, and browser positive-capture phases remain explicit mandatory requirements
  for `founder_browser_experimental`, never hidden behind a skip or N/A record.

## Reconsideration requirements

Before enabling browser staging, record a new ADR selecting one documented topology, exact gateway and
node locations, TLS terminator/renewal model, WebSocket route, gateway and node authentication,
network exposure/allowlist, founder authorization, pairing revocation, offline/restart failure
behavior, shutdown procedure, and the changes needed for multi-user isolation. A multi-user design
also needs a narrow node-side capture command rather than the broad `browser.proxy` surface.
