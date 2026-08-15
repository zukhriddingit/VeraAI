# One-click Browser Connector enrollment

## Status

Approved direction: use a single-use Vera enrollment ticket so an authenticated beta user can
connect an installed Vera Browser Connector without copying or pasting a pairing string.

## Goal

Replace the manual pairing-string step with this user experience:

```text
install extension
  -> sign in to Vera
  -> click Connect this browser
  -> confirm the read-only single-tab boundary
  -> connected on this Chrome profile until explicit revocation
```

Normal Chrome and extension service-worker restarts reconnect automatically. The user must connect
again after explicitly unpairing, server revocation, credential rotation, extension storage removal,
or moving to another Chrome profile or computer.

This work does not make browser access self-serve for unapproved users. A dedicated per-user
Gateway assignment must already exist, and private-beta, Store, privacy, support, cost, and kill-switch
gates remain fail-closed.

## Non-goals

- Do not share a tab automatically.
- Do not remove the explicit one-tab consent boundary.
- Do not reuse a founder Gateway, credential, node, or browser profile for another tester.
- Do not add arbitrary browser, JavaScript, selector, filesystem, shell, contact, application,
  payment, upload, or download capabilities.
- Do not automate marketplace login, 2FA, CAPTCHA, checkpoint, or consent.
- Do not put a durable relay credential in Vera page JavaScript, PostgreSQL, URLs, the clipboard,
  logs, analytics, or audit metadata.
- Do not replace the accepted Gateway image in place. It remains an immutable rollback image.

## Existing behavior

Extension version 2.1.0 already stores `relayUrl` and `token` in `chrome.storage.local`, reconnects
on Chrome startup, and runs a bounded reconnect watchdog. Repeated founder pairing happened because
acceptance deliberately ended with unsharing, unpairing, and credential rotation. Persistence across
ordinary restarts is not missing.

The missing primitive is a secure bootstrap exchange that lets the installed extension obtain its
dedicated Gateway credential after an authenticated Vera action without showing or copying that
credential. The accepted Gateway exposes only the exact `/browser/extension` route and accepts the
durable relay token as a WebSocket subprotocol. It has no one-time enrollment exchange.

## Selected architecture

### Components

1. **Vera settings UI** presents `Connect this browser` only when the signed-in user is an approved
   beta member with an eligible dedicated assignment and a compatible extension is present.
2. **Enrollment ticket service** issues a random 256-bit ticket, persists only its SHA-256 digest,
   and binds it to the exact Vera owner, assignment, safe Gateway origin, extension version, and
   opaque extension-installation identifier digest.
3. **Extension readiness bridge** continues to publish sanitized readiness and adds only the
   extension version, enrollment capability version, and opaque installation identifier digest.
4. **Extension enrollment handler** receives the short-lived ticket and safe Gateway origin from
   the exact allowlisted Vera origin after the user's click.
5. **Gateway route filter** adds one bounded WebSocket enrollment mode on the existing exact
   `/browser/extension` path. It does not add another public route or forward enrollment frames to
   OpenClaw.
6. **Internal enrollment checkpoint** authenticates the dedicated Gateway checkpoint credential
   before parsing the bounded ticket request, resolves that credential to exactly one active owner,
   and atomically consumes the matching ticket.

### Connection sequence

1. The extension creates a random opaque installation identifier on first run and keeps the raw
   value only in `chrome.storage.local`. Readiness exposes its SHA-256 digest, never the raw value.
2. The user opens Browser Connector settings while authenticated to Vera.
3. The page verifies an active dedicated assignment, compatible extension version, beta allowlist
   membership, assignment routing, and the separate enrollment feature flag. Browser-search jobs
   may remain disabled while the trusted device is connected and accepted.
4. The user clicks `Connect this browser` and confirms that Vera remains read-only, sees only one
   explicitly shared tab, and never performs contact or application actions.
5. Vera creates one 60-second, single-use ticket. The response contains the raw ticket, its expiry,
   and the assignment's already validated HTTPS Gateway origin. The response is `no-store` and the
   raw ticket is never logged or audited.
6. The page sends that temporary response to the installed extension through the existing isolated
   content-script bridge. The page never receives a durable credential.
7. The extension opens `wss://<assigned-gateway>/browser/extension` using the fixed enrollment
   subprotocol `vera-browser-enrollment.v1`. The ticket is sent as the first bounded WebSocket frame,
   not in a URL, query string, cookie, authorization header, or WebSocket subprotocol.
8. The route filter accepts at most one enrollment frame, limits it to 4 KiB, applies a ten-second
   timeout, and authenticates to Vera's internal enrollment checkpoint with the existing dedicated
   checkpoint credential.
9. Vera hashes the presented ticket, resolves the checkpoint credential to the exact assignment
   owner before tenant selection, locks the ticket row, and consumes it only when every binding,
   expiry, assignment, version, device, and policy check passes.
10. After an allow decision, the route filter reads the existing `0600` relay credential from the
    fixed Gateway state boundary, returns the exact relay WebSocket URL and credential over that TLS
    connection, clears transient buffers, and closes enrollment mode.
11. The extension validates the response, stores the relay URL and credential in
    `chrome.storage.local`, clears the ticket, and opens the existing relay connection.
12. The settings page observes sanitized `paired` and `relayState` readiness. It never receives the
    credential.

### Why the Gateway change is bounded

The route filter already owns the only public Gateway ingress and exact route enforcement. The new
mode stays on that route, accepts one closed-schema frame, calls one exact internal checkpoint, and
returns only the already existing relay configuration to the authenticated extension. It cannot run
browser commands, inspect tabs, create navigation targets, or weaken the OpenClaw relay protocol.

Because the current image has no enrollment mode, this is an objectively missing bounded primitive.
The change requires a new signed Gateway image. The accepted image
`ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde`
remains unchanged and available as rollback until the new image completes the full release gates.

## Data model

Add `browser_connector_devices`:

- UUID primary key;
- exact Vera user and assignment foreign key;
- SHA-256 opaque installation identifier digest;
- extension version and enrollment protocol version;
- `pending`, `active`, or `revoked` status;
- created, connected, last-seen, and revoked timestamps;
- one live device per assignment.

Add `browser_connector_enrollment_tickets`:

- UUID primary key and exact Vera user, assignment, and device foreign keys;
- unique SHA-256 ticket digest;
- exact safe Gateway origin and required extension/protocol versions;
- issued-at, expires-at, consumed-at, and terminal reason;
- `issued`, `consumed`, `expired`, or `revoked` status;
- one issued ticket per assignment;
- database checks requiring a 60-second-or-shorter lifetime and consistent terminal timestamps.

The raw ticket and durable relay credential are never persisted. Ticket consumption uses one
transaction and row lock so concurrent or replayed exchanges cannot both succeed. Normal cleanup
may expire old unconsumed ticket rows in bounded batches; consumed audit metadata remains secret-free.

## API and protocol contracts

### User-authenticated issuance

`POST /api/settings/integrations/browser-agent/enrollment`

Input:

- exact confirmation literal;
- supported extension version;
- enrollment protocol version;
- opaque installation identifier digest;
- idempotency key.

Output:

- enrollment protocol version;
- raw single-use ticket;
- expiry;
- exact assigned Gateway origin.

The endpoint uses the authenticated session owner, never a caller-supplied user or assignment ID.
It requires `VERA_BROWSER_ENROLLMENT_ENABLED=1` plus the existing beta and assignment-routing gates.
It returns typed denials for missing or inactive assignment, disabled enrollment/beta/routing gates,
revoked assignment/device, incompatible extension, an already active different device, and rate
limiting. `VERA_BROWSER_DISABLED` may remain set while enrollment acceptance is performed because it
continues to deny every browser-search job independently.

### Gateway-authenticated consumption

`POST /api/internal/browser-connector/enrollment/checkpoint`

The route authenticates the dedicated checkpoint bearer before reading a maximum 4 KiB JSON body.
The authenticated credential resolves to one assignment and owner before any ticket lookup or tenant
repository construction. The response is a closed allow/deny schema containing no relay credential.

### Page-to-extension message

The bridge accepts enrollment only from the same top-level window and exact configured Vera origin,
only after a page-created user action. It validates a closed schema, rejects nested frames, and sends
back only sanitized states such as `connecting`, `connected`, `expired`, `denied`, `unavailable`, or
`version_incompatible`.

## Revocation and device replacement

- `Unshare` remains immediate local tab revocation and does not disconnect the trusted device.
- `Unpair` detaches every shared tab, removes the relay URL and credential from Chrome, closes the
  connection, and requires a new enrollment. It retains only the non-secret opaque installation
  identifier so the same approved device can reconnect without being mistaken for a second device.
- Vera's server revocation immediately disables assignment routing and future browser work. It also
  revokes the device and every outstanding ticket.
- The settings page sends a best-effort local clear command to the extension, but server enforcement
  never depends on that message arriving.
- The dedicated Gateway is stopped or its relay credential is rotated through the existing secure
  operator workflow to invalidate an already connected extension transport.
- Connecting another computer is not an automatic takeover. The user first revokes the current
  device, then performs the same one-click connection on the replacement.

## Failure behavior

- Missing extension: show the private Store installation action; issue no ticket.
- No eligible assignment: show concierge onboarding; issue no ticket.
- Gateway unavailable: store no relay credential and let the user request a fresh ticket.
- Expired or replayed ticket: deny without revealing which binding failed; request a fresh ticket.
- Wrong assignment, Gateway, owner, device, origin, or version: deny and audit only safe reason code,
  correlation ID, hashes, and time.
- Network loss after consumption: the ticket remains spent. The extension discards partial data and
  the user clicks Connect again.
- Existing different live device: deny until explicit replacement/revocation.
- Any malformed or oversized frame: close enrollment mode without forwarding it upstream.
- Application, PostgreSQL, or checkpoint outage: fail closed; never fall back to a global Gateway or
  return a pairing credential.

## UI

The Browser Connector settings card has four primary states:

- `Install Browser Connector` when no compatible extension is detected;
- `Waiting for concierge onboarding` when no eligible assignment exists;
- `Connect this browser` when the extension and assignment are ready;
- `Connected on this browser` with explicit `Prepare Vera Search tab`, `Unshare`, and
  `Revoke Browser Connector access` controls.

Copy states that pairing is remembered on this Chrome profile, while login challenges and tab
sharing remain manual. It does not claim public production support while policy is
`experimental_personal`.

## Testing

### Unit and contract tests

- ticket schema, 256-bit generation, digesting, expiry, terminal consistency, and safe serialization;
- exact owner/assignment/Gateway/device/version binding;
- atomic single consumption and concurrent replay denial;
- one-live-device and one-issued-ticket constraints;
- origin, top-frame, closed-schema, and explicit-user-action bridge enforcement;
- enrollment-frame size, timeout, method/protocol, and upstream isolation;
- no raw ticket or relay credential in logs, audits, database rows, URLs, headers, or verifier output;
- extension successful enrollment, reconnect, failed enrollment cleanup, unpair, and revocation state;
- current relay, single-tab, debugger lease, forbidden-action, and readiness regression tests.

### Integration and end-to-end tests

- PostgreSQL repository tests use temporary schemas and prove cross-tenant denial and concurrent
  consumption;
- route tests prove session/CSRF, checkpoint-first authentication, bounded body parsing, kill
  switches, and typed failures;
- a fake Gateway proves the complete click-to-connect flow without external side effects;
- packaging and Store verifiers prove the exact extension permissions remain
  `alarms`, `debugger`, `storage`, `tabGroups`, and `tabs`; no new Chrome permission is required;
- Gateway security tests prove only the exact route is exposed, enrollment never reaches OpenClaw,
  normal relay behavior is unchanged, and wrong/replayed tickets cannot retrieve a credential.

### Live private acceptance

In a clean trusted-tester Chrome profile:

1. install the privately published extension;
2. sign into Vera and click Connect once without copying a secret;
3. restart Chrome and prove automatic relay reconnection;
4. prove no tab is shared automatically;
5. explicitly prepare/share exactly one tab and complete one bounded import;
6. unshare and prove subsequent browser work returns `no_shared_tab` with zero imports;
7. revoke access and prove reconnect/enrollment denial;
8. verify shared tabs zero, connections zero, clipboard bytes zero, and forbidden actions zero.

## Release sequence

1. Implement behind disabled `VERA_BROWSER_ENROLLMENT_ENABLED` and existing assignment-routing
   feature flags. Configure an exact `VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL` on each dedicated
   Gateway while reusing that assignment's existing checkpoint credential.
2. Run focused domain, database, web, extension, route-filter, security, packaging, lint, and
   typecheck suites.
3. Run full CI once on the final branch state.
4. Build one new Gateway image only because the missing enrollment primitive is proven. Verify its
   signature, SBOM, provenance, pinned runtime, and zero HIGH/CRITICAL vulnerabilities.
5. Increment the extension version, package exact verified bytes, and update the private Store item
   with deferred publishing.
6. Keep all production gates disabled while Store review, privacy lifecycle, support round-trip, and
   exact tester infrastructure cost approvals remain incomplete.
7. Provision an isolated tester assignment, activate it while browser jobs remain disabled, enable
   enrollment for only that exact tester, and complete connection acceptance. Enable browser jobs
   only for the subsequent bounded listing acceptance window.
8. Roll back by disabling enrollment/browser routing and restoring the previous immutable Gateway
   image. Never restore an old credential or delete PostgreSQL listing data.

## Acceptance criteria

- An approved tester connects from the signed-in Vera page with one explicit click and no copied or
  displayed pairing credential.
- The connection persists through ordinary Chrome restarts.
- The durable relay credential exists only in the dedicated Gateway and Chrome extension storage.
- Tickets are single-use, expire within 60 seconds, and cannot cross users, assignments, Gateways,
  devices, or versions.
- A second computer cannot silently replace the first.
- Connecting does not share a tab; explicit unshare and unpair behavior remains intact.
- Server revocation stops future Vera browser work even if the local clear message is missed.
- Existing four-source search and the deterministic listing pipeline remain intact.
- Forbidden external action count remains zero.
- The accepted Gateway image and PostgreSQL data remain preserved.
