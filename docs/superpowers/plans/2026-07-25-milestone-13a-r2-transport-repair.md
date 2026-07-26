# Milestone 13A-R2 Transport Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Locate and repair the exact WebSocket layer that prevents the official OpenClaw Chrome extension from pairing directly with a dedicated Maritime Gateway, then collect a new fail-closed R2 evidence bundle.

**Architecture:** A shared secret-safe WebSocket probe drives four differential tests: exact image behind local TLS, Maritime container-internal routing, a generic Maritime edge diagnostic, and the final real extension retry. Each layer emits a closed sanitized observation; the first divergent layer determines the only permitted fix.

**Tech Stack:** TypeScript 6, Node.js 24, `ws` 8.21.1, Vitest 4, Playwright 1.61.1, Docker, OpenSSL, OpenClaw 2026.7.1, Maritime CLI 1.7.0.

## Global Constraints

- Run every repository command from `/private/tmp/vera-founder-staging-evidence-pr`.
- Require branch `codex/founder-browser-remote-extension`.
- Initial R2 source HEAD is `494d316` after the approved design commit.
- Never inspect, modify, clean, reset, stash, stage, or commit the older desktop workspace.
- Preserve `release-evidence/private/m13a-release-evidence-bundle-final.json` byte-for-byte.
- Use R2 identifier `m13a-r2-20260725-01`.
- Store real evidence only in gitignored `release-evidence/private/` at directory mode `0700` and file mode `0600`.
- Never log a pairing credential, credential-bearing subprotocol, raw endpoint, agent ID, full header set, profile path, target ID, browser content, or screenshot.
- Do not publish a new public image without separate explicit approval.
- Do not implement Milestone 13B, source discovery, hosted browsing, or marketplace adapters.
- Do not weaken Origin validation, pairing, subprotocol authentication, route isolation, or the official OpenClaw protocol.
- Use exact immutable Gateway image `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:a19542d467b81b7f1ae3bafb48952e3fdf9ddc6c324c97820680bd39be2a3b1c`.
- Provision at most one disposable Gateway agent and one disposable diagnostic agent at a time.
- Delete both disposable agents and revoke every temporary credential before completion.

---

### Task 1: Add the secret-safe WebSocket transport probe

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/staging/websocket-transport-probe.ts`
- Create: `scripts/staging/websocket-transport-probe.unit.test.ts`
- Modify: `scripts/staging/remote-extension-proxy-smoke.ts`
- Modify: `scripts/staging/remote-extension-proxy-smoke.unit.test.ts`

**Interfaces:**
- Consumes: WSS URL, optional Origin, ordered protocols, credential protocol index, timeout, stability window, and bounded payload.
- Produces:

```ts
export interface WebSocketTransportCase {
  readonly caseId: string;
  readonly url: string;
  readonly origin: string | null;
  readonly protocols: readonly string[];
  readonly credentialProtocolIndexes: readonly number[];
  readonly stabilityMilliseconds: number;
  readonly timeoutMilliseconds: number;
  readonly payload: Uint8Array | null;
}

export interface SanitizedWebSocketObservation {
  readonly caseId: string;
  readonly reachedOpen: boolean;
  readonly httpStatus: number | null;
  readonly selectedProtocol: string | null;
  readonly offeredProtocolCount: number;
  readonly nonSecretProtocols: readonly string[];
  readonly credentialProtocolSha256: readonly string[];
  readonly originPresent: boolean;
  readonly originScheme: "chrome-extension" | "https" | "http" | "other" | null;
  readonly lifetimeMilliseconds: number;
  readonly closeCode: number | null;
  readonly pingPong: "passed" | "failed" | "not_run";
  readonly boundedEcho: "passed" | "failed" | "not_run";
  readonly errorCode:
    | "none"
    | "http_rejection"
    | "network_error"
    | "timeout"
    | "closed_early"
    | "unexpected_protocol";
}

export function credentialProtocolSha256(protocol: string): string;
export function sanitizeProtocols(
  protocols: readonly string[],
  credentialIndexes: readonly number[]
): {
  readonly protocolCount: number;
  readonly nonSecretProtocols: readonly string[];
  readonly credentialProtocolSha256: readonly string[];
};
export function runWebSocketTransportCase(
  input: WebSocketTransportCase
): Promise<SanitizedWebSocketObservation>;
```

- `remote-extension-proxy-smoke.ts` uses this probe instead of the global browser-style
  `WebSocket`, allowing exact Origin control and HTTP rejection status without exposing secrets.

- [ ] **Step 1: Add failing redaction and handshake tests**

```ts
it("hashes credential protocols and never returns their values", () => {
  const credential = `openclaw-extension-token.${"a".repeat(64)}`;
  const sanitized = sanitizeProtocols(
    ["openclaw-extension-relay", credential],
    [1]
  );
  expect(sanitized).toEqual({
    protocolCount: 2,
    nonSecretProtocols: ["openclaw-extension-relay"],
    credentialProtocolSha256: [credentialProtocolSha256(credential)]
  });
  expect(JSON.stringify(sanitized)).not.toContain(credential);
});

it("reports the HTTP status from a rejected upgrade", async () => {
  const observation = await runWebSocketTransportCase(
    rejectedFixture({ status: 403 })
  );
  expect(observation).toMatchObject({
    reachedOpen: false,
    httpStatus: 403,
    errorCode: "http_rejection"
  });
});
```

- [ ] **Step 2: Run the narrow test and confirm failure**

Run:

```sh
/opt/homebrew/Cellar/node@24/24.18.0/bin/node \
  node_modules/vitest/vitest.mjs run --project unit \
  scripts/staging/websocket-transport-probe.unit.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add exact dependencies**

Run:

```sh
pnpm add --save-dev --save-exact ws@8.21.1 @types/ws@8.18.1
```

Expected: `package.json` and `pnpm-lock.yaml` contain exact versions.

- [ ] **Step 4: Implement the closed probe**

Use `ws` event boundaries:

```ts
const socket = new WebSocket(input.url, [...input.protocols], {
  headers: input.origin ? { Origin: input.origin } : undefined,
  followRedirects: false,
  handshakeTimeout: input.timeoutMilliseconds,
  maxPayload: 128 * 1024
});

socket.once("unexpected-response", (_request, response) => {
  finish({
    reachedOpen: false,
    httpStatus: response.statusCode ?? null,
    selectedProtocol: null,
    errorCode: "http_rejection"
  });
  response.resume();
});
```

The returned object must be built only from the sanitized protocol summary, status, selected
non-secret protocol, timings, close code, and bounded booleans. Never include request headers or
`input.url`.

- [ ] **Step 5: Replace the old live smoke socket boundary**

Build three `WebSocketTransportCase` values:

```ts
const unrelated = {
  caseId: "unrelated_route",
  url: unrelatedRouteFor(extensionUrl),
  origin: chromeExtensionOrigin,
  protocols: [],
  credentialProtocolIndexes: [],
  stabilityMilliseconds,
  timeoutMilliseconds,
  payload: null
};
```

The correct and wrong-secret cases each use two protocols and mark index `1` as credential-bearing.
Extend live environment parsing with:

```text
OPENCLAW_EXTENSION_ORIGIN=chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Validation returns only the scheme and never the extension ID.

- [ ] **Step 6: Run narrow tests**

Run:

```sh
/opt/homebrew/Cellar/node@24/24.18.0/bin/node \
  node_modules/vitest/vitest.mjs run --project unit \
  scripts/staging/websocket-transport-probe.unit.test.ts \
  scripts/staging/remote-extension-proxy-smoke.unit.test.ts
```

Expected: all tests pass and serialized results contain no credential value, URL, or extension ID.

- [ ] **Step 7: Verify isolation and commit**

Run:

```sh
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git diff --check
git add package.json pnpm-lock.yaml \
  scripts/staging/websocket-transport-probe.ts \
  scripts/staging/websocket-transport-probe.unit.test.ts \
  scripts/staging/remote-extension-proxy-smoke.ts \
  scripts/staging/remote-extension-proxy-smoke.unit.test.ts
git commit -m "test: add secret-safe websocket transport matrix"
```

Expected: clean authoritative path and branch; commit succeeds.

---

### Task 2: Add the local TLS proxy and generic diagnostic service

**Files:**
- Create: `scripts/staging/local-websocket-tls-proxy.ts`
- Create: `scripts/staging/local-websocket-tls-proxy.unit.test.ts`
- Create: `infra/maritime/diagnostics/websocket-diagnostic-server.mjs`
- Create: `infra/maritime/diagnostics/websocket-diagnostic-server.unit.test.ts`
- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- `startLocalWebSocketTlsProxy` accepts a TLS key/certificate path, listen host/port, and exact
  upstream host/port. It forwards raw HTTP upgrade bytes without rewriting path, Origin, or
  `Sec-WebSocket-Protocol`.
- `startDiagnosticWebSocketServer` accepts an exact path, allowed Origin schemes, selected harmless
  protocol, maximum payload bytes, and idle timeout.
- Both return a close function and bound port; both expose sanitized observations only.

```ts
export interface LocalTlsProxyOptions {
  readonly keyPath: string;
  readonly certificatePath: string;
  readonly listenHost: "127.0.0.1";
  readonly listenPort: number;
  readonly upstreamHost: "127.0.0.1";
  readonly upstreamPort: number;
}

export async function startLocalWebSocketTlsProxy(
  options: LocalTlsProxyOptions
): Promise<{ readonly port: number; close(): Promise<void> }>;
```

- [ ] **Step 1: Write failing byte-preservation tests**

The test sends an upgrade containing:

```http
GET /browser/extension HTTP/1.1
Origin: chrome-extension://synthetic-extension
Sec-WebSocket-Protocol: harmless-one, harmless-two
```

The synthetic upstream must receive the same path, Origin, and ordered protocol value, then return
`101` with `Sec-WebSocket-Protocol: harmless-one`.

- [ ] **Step 2: Write failing diagnostic-server tests**

Cover:

- correct path plus two harmless protocols selects the configured value;
- wrong path returns `404`;
- invalid Origin returns `403`;
- credential-shaped protocols are represented only by SHA-256;
- ping/pong passes;
- a 32 KiB payload echoes;
- a payload over 64 KiB closes with `1009`; and
- logs contain no raw credential protocol.

- [ ] **Step 3: Implement the TLS tunnel**

Use `https.createServer` for TLS termination and `net.connect` for raw upgrade forwarding. On
`upgrade`, serialize `request.rawHeaders` exactly once and pipe both sockets after the upstream
connection opens. Set a 40-second hard timeout and never emit headers to logs.

- [ ] **Step 4: Implement the diagnostic service**

The module starts an HTTP server and a `WebSocketServer({ noServer: true, maxPayload: 65_536 })`.
Before `handleUpgrade`, it validates exact path and Origin scheme. `handleProtocols` selects only
the configured harmless protocol. Structured output uses:

```js
{
  event: "upgrade_observed",
  pathClass: "accepted",
  originPresent: true,
  originScheme: "chrome-extension",
  protocolCount: 2,
  nonSecretProtocols: ["harmless-one", "harmless-two"],
  credentialProtocolSha256: [],
  reachedContainer: true
}
```

- [ ] **Step 5: Add a static safety verifier**

`verify-remote-extension-config.ts` must reject diagnostic source containing:

- `console.log(req.headers)`;
- raw `sec-websocket-protocol` emission;
- URL query logging;
- unbounded `maxPayload`;
- wildcard Origin acceptance; or
- a non-exact path check.

- [ ] **Step 6: Add scripts**

```json
{
  "test:staging:remote-extension-transport": "tsx scripts/staging/websocket-transport-probe.ts",
  "test:staging:websocket-diagnostic": "node infra/maritime/diagnostics/websocket-diagnostic-server.mjs"
}
```

- [ ] **Step 7: Run tests and verifiers**

Run:

```sh
/opt/homebrew/Cellar/node@24/24.18.0/bin/node \
  node_modules/vitest/vitest.mjs run --project unit \
  scripts/staging/local-websocket-tls-proxy.unit.test.ts \
  infra/maritime/diagnostics/websocket-diagnostic-server.unit.test.ts \
  scripts/verify-remote-extension-config.unit.test.ts
/opt/homebrew/Cellar/node@24/24.18.0/bin/node \
  node_modules/tsx/dist/cli.mjs scripts/verify-remote-extension-config.ts
git diff --check
```

Expected: all tests and the static verifier pass.

- [ ] **Step 8: Verify isolation and commit**

Run the five worktree identity commands, then:

```sh
git add package.json \
  scripts/staging/local-websocket-tls-proxy.ts \
  scripts/staging/local-websocket-tls-proxy.unit.test.ts \
  infra/maritime/diagnostics/websocket-diagnostic-server.mjs \
  infra/maritime/diagnostics/websocket-diagnostic-server.unit.test.ts \
  scripts/verify-remote-extension-config.ts \
  scripts/verify-remote-extension-config.unit.test.ts
git commit -m "test: add layered websocket diagnostics"
```

Expected: commit succeeds without staging private evidence.

---

### Task 3: Bootstrap immutable R2 evidence and verify the upstream protocol

**Files:**
- Create outside Git: `release-evidence/private/m13a-r2-20260725-01-identities.json`
- Create outside Git: `release-evidence/private/m13a-r2-20260725-01-protocol.json`
- Do not modify: `release-evidence/private/m13a-release-evidence-bundle-final.json`

**Interfaces:**
- Consumes: immutable image metadata and read-only source markers inside that image.
- Produces: two strict private JSON files with no endpoint, secret, agent ID, or browser data.

- [ ] **Step 1: Verify worktree and R1 hash**

Run:

```sh
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
git rev-parse HEAD
shasum -a 256 \
  release-evidence/private/m13a-release-evidence-bundle-final.json
```

Expected R1 file hash:

```text
6d07a38907bcc8b543ccab39b88105df165b6b53af54938a058bdf98fc01f011
```

- [ ] **Step 2: Ensure private modes**

Run:

```sh
mkdir -p release-evidence/private
chmod 700 release-evidence/private
umask 077
```

Expected: directory mode `0700`.

- [ ] **Step 3: Record exact identities**

Collect and validate:

```text
R2 ID: m13a-r2-20260725-01
Gateway digest: sha256:a19542d467b81b7f1ae3bafb48952e3fdf9ddc6c324c97820680bd39be2a3b1c
Vera image source commit: ea95c6a2a92d12625b3db0d71f45823cf7c28b8e
OpenClaw: 2026.7.1
Extension manifest: 3
Extension version: 2.0.0
Extension source: bundled-official-image
Maritime CLI: 1.7.0
```

Write only these values plus a UTC timestamp to the new identity file at mode `0600`.

- [ ] **Step 4: Inspect exact source markers**

Run the immutable image with a read-only entrypoint and verify:

```text
/browser/extension is claimed by the Gateway upgrade handler
Origin accepts empty or chrome-extension scheme
fixed non-secret protocol is openclaw-extension-relay
credential protocol is parsed after openclaw-extension-token prefix
wrong credential returns 401
invalid Origin returns 403
successful route uses WebSocketServer.handleUpgrade
public route is Gateway port 18789
loopback relay path is /extension on the derived relay port
```

The protocol JSON records only protocol count `2`, fixed non-secret protocol, SHA-256 of a
synthetic credential-shaped value, status rules, route, and port classification.

- [ ] **Step 5: Validate privacy and modes**

Run a local schema check that rejects keys named `secret`, `token`, `url`, `agentId`, `headers`,
`profilePath`, or `content`. Confirm both new files are mode `0600` and are ignored by Git.

Expected: zero violations and `git status --short` does not list either file.

---

### Task 4: Run Test A against the exact image without Maritime

**Files:**
- Create outside Git: private TLS key/certificate and Test A raw/sanitized evidence.
- Do not modify committed source unless Test A exposes a defect.

**Interfaces:**
- Consumes: exact Gateway image, official bundled extension, local TLS proxy, and one disposable
  Chrome profile.
- Produces: `m13a-r2-20260725-01-test-a.json` with only sanitized status, selected protocol,
  lifetimes, counts, hashes, and snapshot summary.

- [ ] **Step 1: Create a disposable Docker network and private credentials**

Use exact names:

```text
Docker network: vera-m13a-r2-local
Gateway container: vera-m13a-r2-gateway-local
TLS listen: 127.0.0.1:18443
Temporary Chrome profile: system temporary directory
```

Generate a 32-byte Gateway token and TLS key in `release-evidence/private/` with `umask 077`.
Never print them.

- [ ] **Step 2: Start the exact Gateway image**

Bind only loopback host ports needed for the test. Confirm:

- Gateway process UID/GID `1000`;
- `/data/.openclaw` mode `0700`;
- config mode `0600`;
- listener `0.0.0.0:18789`; and
- no public route other than the test loopback binding.

- [ ] **Step 3: Generate an official local pairing string**

Run `openclaw browser extension pair --gateway-url wss://127.0.0.1:18443` as UID `1000`.
Store output privately. Parse it without printing the fragment. Record only:

- route ends `/browser/extension`;
- fragment length `64`;
- lowercase hexadecimal true; and
- SHA-256 of the credential-bearing protocol value.

- [ ] **Step 4: Run raw correct and failure cases**

Use `runWebSocketTransportCase` with:

- no token;
- wrong token;
- correct token;
- invalid Origin;
- exact Chrome-extension Origin; and
- unrelated route.

Acceptance:

```text
no token -> 401
wrong token -> 401
invalid Origin -> 403
unrelated route -> non-101 denial
correct token -> 101
selected protocol -> openclaw-extension-relay
stable -> at least 5000 ms
```

- [ ] **Step 5: Load the exact extension in a disposable Chrome profile**

Copy `/app/dist/extensions/browser/chrome-extension` from the immutable image into a system
temporary directory. Launch only:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

with `--user-data-dir`, `--disable-extensions-except`, `--load-extension`, and
`--ignore-certificate-errors` against the temporary profile. Do not connect to the existing Chrome
profile.

Use the exact popup selectors:

```text
#pairingString
#pairButton
#statusDot.on
#shareButton
#unpairButton
```

Create one blank test tab, make it active, and click `#shareButton`. Verify the popup reports one
shared tab.

- [ ] **Step 6: Request one minimized snapshot**

Invoke only Vera's exported fixed empty-input snapshot boundary inside the Gateway container:

```sh
docker exec -u 1000:1000 vera-m13a-r2-gateway-local \
  node --input-type=module -e \
  'import { readSharedTabSnapshot } from "/opt/vera/plugins/vera-read-shared-tab/index.mjs"; const result = await readSharedTabSnapshot({}); process.stdout.write(JSON.stringify(result));'
```

Redirect the result to a mode-`0600` private evidence file without printing it. Validate:

- one shared tab;
- sanitized origin/title;
- at most 24 bounded lines;
- no query, fragment, form value, email, phone, target ID, profile path, screenshot, or raw
  snapshot; and
- source/result hashes present.

Persist only the minimized schema and its hash, never the page body or raw CDP result.

- [ ] **Step 7: Revoke and clean Test A**

Click `#shareButton` again and verify shared-tab count becomes zero. Click `#unpairButton`, stop
Chrome, delete its temporary profile, remove the local pairing secret, stop the proxy and container,
and remove only Docker network `vera-m13a-r2-local`.

- [ ] **Step 8: Apply the Test A gate**

If any Test A acceptance fails:

- set exact classification `image_openclaw_extension_or_local_proxy_defect`;
- add one regression test in the smallest relevant file;
- do not provision Maritime agents;
- do not publish an image; and
- proceed directly to Task 7's permitted local-fix branch.

If every acceptance passes, proceed to Task 5.

---

### Task 5: Run Test B through the Maritime container path

**Files:**
- Create outside Git: `release-evidence/private/m13a-r2-20260725-01-test-b.json`
- Do not modify production infrastructure.

**Interfaces:**
- Disposable Gateway agent name: `vera-m13a-r2-gateway-20260725`.
- Public configured port: `18789`.
- Produces sanitized process/listener/path/header-presence observations.

- [ ] **Step 1: Confirm isolation immediately before remote mutation**

Run the five worktree identity commands and verify the R1 file hash. Stop if any path, branch, or
hash differs.

- [ ] **Step 2: Create exactly one Gateway agent**

Create a public always-on disposable agent with configured port `18789`, then deploy the exact
immutable Gateway image. Import only a fresh Gateway token from a mode-`0600` private env file.

- [ ] **Step 3: Inspect processes and listeners**

Record sanitized facts from:

```sh
ps -eo pid,ppid,uid,gid,comm,args
ss -ltnp
```

Keep only process names, UID/GID, listening addresses/ports, and ingress-shim source/target ports.
Do not retain environment values or public identifiers.

- [ ] **Step 4: Probe Gateway directly inside the container**

Generate a fresh official pairing value as UID `1000`. Run correct, wrong, missing, invalid-Origin,
and unrelated-route upgrades against `ws://127.0.0.1:18789/browser/extension`.

Expected direct result matches Test A.

- [ ] **Step 5: Probe through the provider ingress shim from inside**

Target the shim's observed listener, not an assumed port. Record:

- exact versus rewritten path classification;
- redirect status;
- Origin presence/scheme;
- protocol count;
- fixed protocol presence;
- credential protocol SHA-256; and
- whether OpenClaw emits its sanitized connection event.

- [ ] **Step 6: Apply the Test B gate**

If direct Gateway passes but shim fails, classify
`maritime_container_port_or_ingress_shim_defect` and identify the first divergent field.
Otherwise proceed to Test C.

Keep the Gateway agent only through Test D if Test B passes. Delete it immediately if Test B fails.

---

### Task 6: Run Test C against the Maritime edge

**Files:**
- Create outside Git: `release-evidence/private/m13a-r2-20260725-01-test-c.json`
- Use committed diagnostic source from Task 2.

**Interfaces:**
- Diagnostic agent name: `vera-m13a-r2-wssdiag-20260725`.
- Configured public port: `18080`.
- Exact diagnostic path: `/browser/extension`.
- Harmless protocols: `vera-diag-one`, `vera-diag-two`.
- Payload size: `32,768` bytes.
- Stability window: `30,000` milliseconds.

- [ ] **Step 1: Confirm isolation immediately before remote mutation**

Run the five worktree identity commands and verify the R1 file hash.

- [ ] **Step 2: Create exactly one diagnostic agent**

Deploy the already-public immutable Gateway image to the diagnostic agent only as a trusted runtime
carrier. On this disposable agent:

1. identify and stop only the provider `portfwd` process bound to `18080`;
2. start `websocket-diagnostic-server.mjs` through a bounded live `maritime exec` session on
   `0.0.0.0:18080`; and
3. keep the session open only while the matrix runs.

Do not publish another image. If the provider edge cannot reach this process, stop and request
separate approval for a public diagnostic image rather than bypassing the permission boundary.

- [ ] **Step 3: Run all twelve matrix cases**

Run:

```text
1  no subprotocol
2  one harmless subprotocol
3  two harmless subprotocols
4  openclaw-extension-relay plus harmless companion
5  chrome-extension Origin
6  exact /browser/extension
7  provider prefix path
8  30-second idle
9  ping/pong
10 32 KiB echo
11 invalid Origin
12 invalid path
```

For every case, record only the closed sanitized observation schema.

- [ ] **Step 4: Classify the edge**

Generic success requires:

- valid cases return `101`;
- `vera-diag-one` is selected when offered;
- Origin scheme reaches the container unchanged;
- exact route reaches the container;
- prefix behavior is classified;
- idle stays open for 30 seconds;
- ping/pong passes;
- 32 KiB echo passes;
- invalid Origin returns `403`; and
- invalid path returns `404`.

If generic Test C fails after Tests A and B pass, classify `maritime_edge_proxy_defect` and retain a
sanitized provider report with this closed shape:

```ts
{
  testId: "m13a-r2-20260725-01",
  disposableAgentReference: sha256(agentId).slice(0, 16),
  executedAt: new Date().toISOString(),
  sanitizedCorrelationReferences: correlationIds.map((value) =>
    sha256(value).slice(0, 16)
  ),
  expected: "HTTP 101 with selected harmless protocol",
  observedHttpStatus: 403,
  enteredEdge: {
    upgrade: true,
    connection: true,
    originScheme: "chrome-extension",
    protocolCount: 2
  },
  reachedContainer: false,
  harmlessProtocols: ["vera-diag-one", "vera-diag-two"],
  requestedConfirmation: [
    "wss_upgrade",
    "chrome_extension_origin",
    "multiple_subprotocols",
    "response_subprotocol",
    "browser_extension_route",
    "idle_timeout",
    "maximum_header_and_frame_size"
  ]
}
```

The report is prepared for provider support but is not sent through an unrelated communication
channel.

- [ ] **Step 5: Stop and delete the diagnostic agent**

End the live exec session, delete `vera-m13a-r2-wssdiag-20260725`, and confirm status returns
not-found. Do not leave the reproducer running without a provider-approved debugging window.

---

### Task 7: Implement only the proven smallest fix

**Files:**
- Modify only the file selected by the decision table below.
- Test the corresponding existing or newly added narrow regression.

**Interfaces:**
- Consumes: first divergent boundary from Tests A through C.
- Produces: one exact fix classification and a passing regression test.

- [ ] **Step 1: Select exactly one permitted repair branch**

| Proven divergence | Smallest permitted change | Files |
|---|---|---|
| Maritime configured port differs from actual listener | Set disposable/public Gateway port to `18789`; update runbook/verifier | `docs/BROWSER_CONNECTOR.md`, `infra/maritime/OPENCLAW.md`, `scripts/verify-release-documentation.ts` |
| Provider shim targets relay/CDP instead of Gateway | Configure target `18789`; forbid derived relay ports | same documentation/verifier files |
| Local TLS proxy rewrites upgrade fields | Fix raw upgrade forwarding | `scripts/staging/local-websocket-tls-proxy.ts` and its test |
| Vera probe omits exact Chrome Origin or masks rejection status | Fix probe input/observation only | `scripts/staging/websocket-transport-probe.ts`, `scripts/staging/remote-extension-proxy-smoke.ts`, tests |
| OpenClaw `2026.7.1` source or bundled extension fails Test A | Patch local config/entrypoint only if source proves a config defect | `infra/maritime/openclaw/remote-extension.openclaw.json5`, `infra/maritime/openclaw/remote-extension-entrypoint.sh`, verifier/tests |
| Generic Maritime edge fails | No Vera protocol weakening; produce provider report | private evidence plus `docs/DECISIONS/0013-founder-browser-direct-remote-extension.md` |
| Generic edge passes but OpenClaw fails | Correct exact route/port/origin forwarding without changing protocol | smallest applicable config, entrypoint, probe, and regression |
| Upgrade passes but idle fails | Use always-on tier or provider-documented timeout only | runbook/verifier; no unbounded timeout |

- [ ] **Step 2: Write the regression first**

The test must reproduce the exact divergent field. Examples:

```ts
expect(observation.httpStatus).toBe(101);
expect(observation.selectedProtocol).toBe("openclaw-extension-relay");
expect(observation.originScheme).toBe("chrome-extension");
```

- [ ] **Step 3: Run the regression and confirm failure**

Run only the exact test file and case. Expected: FAIL for the observed root cause.

- [ ] **Step 4: Apply the smallest implementation**

Do not edit any other layer. Do not change pairing placement, Origin checks, protocol names,
authentication, or route scope.

- [ ] **Step 5: Run the regression and affected verifiers**

Expected: the regression passes and all remote-extension boundary tests remain passing.

- [ ] **Step 6: Decide whether an image is required**

- Documentation, disposable port selection, or external provider repair: no new Gateway image.
- Entrypoint or OpenClaw config change: a new image is required.
- OpenClaw version change: allowed only after exact incompatibility proof and reviewed replacement.

If a new public image is required, stop before publishing and request explicit approval with the
local image digest, source commit, regression evidence, and exact reason.

- [ ] **Step 7: Verify isolation and commit**

Run the five worktree identity commands, review the exact diff, stage only selected files, and
commit:

```sh
git commit -m "fix: repair remote extension transport boundary"
```

If the repair is provider-only and no repository file changes, do not create an empty commit.

---

### Task 8: Run Test D, audits, evidence, and cleanup

**Files:**
- Modify: `docs/DECISIONS/0013-founder-browser-direct-remote-extension.md`
- Modify: `docs/BROWSER_CONNECTOR.md`
- Modify: `docs/RELEASE_READINESS.md`
- Create outside Git: `release-evidence/private/m13a-r2-20260725-01-*.json`

**Interfaces:**
- Consumes: repaired boundary, exact extension, fresh Gateway, and strict evidence validator.
- Produces: new R2 evidence bundle, final classification, and complete teardown.

- [ ] **Step 1: Provision a fresh final Gateway**

Delete any Test B Gateway first. Reconfirm worktree isolation. Create a fresh always-on Gateway
using the approved immutable image or, only after separate approval, an approved replacement
digest.

- [ ] **Step 2: Pair the disposable Chrome profile**

Generate a new official pairing string from the actual public WSS base. Use only the exact reviewed
extension in a new temporary Chrome profile and one blank/test tab.

- [ ] **Step 3: Run final transport and consent acceptance**

Verify:

- unrelated route denied;
- wrong secret denied;
- correct `101`;
- selected `openclaw-extension-relay`;
- 30-second stability;
- required device approval;
- exactly one shared test tab;
- one minimized snapshot;
- no non-snapshot interaction;
- tab removal revokes access; and
- unpair prevents reconnect.

Collect the minimized snapshot by running the same exported
`readSharedTabSnapshot({})` boundary as UID `1000` through `maritime exec`; do not route the
connectivity acceptance through an LLM or allow any additional tool.

- [ ] **Step 4: Run security audits**

As Gateway UID `1000`:

```sh
openclaw security audit --json
openclaw security audit --deep --json
```

Seed only the temporary read-only `operator.read` audit identity, then remove it. Acceptance is
zero critical, zero warnings, and informational attack-surface findings only.

- [ ] **Step 5: Revoke credentials and delete agents**

Remove the extension relay-secret file, remove temporary audit identity, delete the Gateway, and
confirm status is not-found. Confirm the diagnostic agent is also absent.

- [ ] **Step 6: Generate a distinct R2 evidence bundle**

Use existing canonical evidence helpers:

```ts
withRecordContentHash(record);
withBundleContentHash(bundle);
validateEvidenceBundle(bundle, { decisionAt });
classifyEvidenceBundle(bundle, decisionAt);
```

Never overwrite an R1 filename. The R2 bundle includes all profile-required phases and references
only sanitized private artifact hashes.

- [ ] **Step 7: Reverify R1 immutability and R2 determinism**

Expected:

```text
R1 file SHA-256 = 6d07a38907bcc8b543ccab39b88105df165b6b53af54938a058bdf98fc01f011
R2 canonical hash matches declared bundle hash
R2 hash is deterministic on repeated canonicalization
R2 validator violations = 0
```

- [ ] **Step 8: Update documentation with the exact result**

Document Tests A through D, the exact root cause, smallest fix, image requirement, audit summary,
cleanup, and final classification. Never include endpoints, agent IDs, secrets, raw headers, or
browser content.

- [ ] **Step 9: Run final local validation**

Under Node `24.18.0` run:

```sh
VERA_NODE24=/opt/homebrew/Cellar/node@24/24.18.0/bin/node
git diff --check
"$VERA_NODE24" node_modules/prettier/bin/prettier.cjs --check .
"$VERA_NODE24" node_modules/eslint/bin/eslint.js . --max-warnings=0
"$VERA_NODE24" node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
for VERA_TSCONFIG in apps/*/tsconfig.json packages/*/tsconfig.json; do
  "$VERA_NODE24" node_modules/typescript/bin/tsc --noEmit -p "$VERA_TSCONFIG"
done
"$VERA_NODE24" node_modules/vitest/vitest.mjs run --project unit
"$VERA_NODE24" node_modules/tsx/dist/cli.mjs scripts/verify-remote-extension-config.ts
"$VERA_NODE24" node_modules/tsx/dist/cli.mjs scripts/verify-release-documentation.ts
```

Expected: formatting, lint, typecheck, full unit suite, and both verifiers pass.

- [ ] **Step 10: Verify isolation and commit documentation**

Run the five identity commands, verify private evidence is ignored and no secret file is staged,
then commit only sanitized documentation and tests:

```sh
git commit -m "docs: record milestone 13a r2 transport result"
```

Final report must state:

1. exact root cause;
2. evidence from Tests A through D;
3. fix implemented;
4. files changed;
5. whether a new image was required;
6. whether publication required approval;
7. final live-extension result;
8. security-audit result;
9. cleanup result;
10. final classification; and
11. whether Milestone 13B is authorized.
