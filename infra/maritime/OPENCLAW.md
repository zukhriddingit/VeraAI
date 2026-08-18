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

That was the base for the rejected R1 Gateway artifact:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:a19542d467b81b7f1ae3bafb48952e3fdf9ddc6c324c97820680bd39be2a3b1c
```

R2 Test A proved that the artifact's intended extension route authenticates and upgrades locally,
but its generic OpenClaw Gateway WebSocket also accepts an unrelated route. It is retained only as
baseline evidence and must not be deployed. The bootstrap-compatible candidate described below is
published but is not deployable. `remote-extension-image.json` records separate `releaseIndex` and
`runtimeManifest` identities with `runtimeSelectionState: diagnostic_pending` and
`deployableBeforeLiveProxyAcceptance: false`.

A later public route-filter candidate was also rejected:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5d1f6d2d097bb8e53f2e2dd6c1e6f8499d6daf34dff8a61b9b0c187fd9e1ec6b
```

Trivy found 23 critical and 98 high vulnerabilities in that candidate. Signing and deployment
correctly did not occur. It must never be used as the Gateway replacement.

## Zero-finding replacement boundary

The pending replacement preserves the reviewed OpenClaw 2026.7.1 application from the immutable
source image above, including source commit
`2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4`. It sanitizes exactly eight vulnerable application
package instances, each from a fixed npm tarball with a locked SHA-512 integrity:

- `@opentelemetry/propagator-jaeger` 2.8.0 to 2.9.0;
- `@vitest/browser` 4.1.9 to 4.1.10;
- `brace-expansion` 5.0.7 to 5.0.9;
- `fast-uri` 3.1.2 to 3.1.5;
- `ip-address` 10.2.0 to 10.3.1;
- `postcss` 8.5.16 to 8.5.18; and
- root `undici` 8.5.0 to 8.9.0; and
- the `jsdom`-nested `undici` 7.28.0 to 7.29.0.

The repaired `/app` tree is transplanted into the immutable `linux/amd64` Chainguard Node runtime:

```text
cgr.dev/chainguard/node@sha256:942c2eee772885f64808bf0fed5e5f842eafe4d6fe7f602b7dba0f26b6eb1b22
```

`remote-extension-candidate.json` records this security replacement as pending without
claiming that it has been published. `remote-extension-image.json` continues to record the exact
previously published Gateway identity and its original runtime base. The pending candidate cannot
be deployed; publication, signing, provenance, SBOM, attestations, and a follow-up immutable release
binding remain separate gated work.

The final layer deletes the Chainguard package-manager library and every executable except
`/usr/bin/node`. The image therefore has no shell, npm, npx, node-gyp, Corepack, pnpm, or BusyBox
runtime. A fixed Node supervisor replaces the old shell entrypoint, requires UID/GID `1000:1000`,
repairs only the fixed private state tree, rejects symlinks, and starts only Vera's fixed
route-filter child.

`pnpm verify:gateway-runtime-supply-chain` validates the immutable source, runtime, dependency
lock, three-stage copy boundary, tool pruning, final identity, and entrypoint. PR CI independently
builds the `linux/amd64` image without secrets or publication, checks the executable inventory, and
runs Trivy 0.72.0 with fixed and unfixed `CRITICAL,HIGH` findings enabled.

The replacement base preserves the minimal runtime while updating Node from 26.6.0 to 26.7.0 and
the Wolfi `npm-12` package from 12.0.2-r1 to 12.0.2-r2, which fixes CVE-2026-69152 and
CVE-2026-69192. The 2026-07-26 local candidate passed that identity check, a Trivy 0.72.0 finding
count of zero, all
focused transport tests, and a real loopback startup check: only port `18789` was publicly bound,
the exact extension route returned `426`, and unrelated HTTP routes returned `404`. This local
result is stored only as restricted gitignored evidence and is not a registry, signature,
attestation, proxy, or Maritime acceptance result.

The zero-finding replacement was published and independently verified at:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3
source revision: 83b65bf4e60f4d1bbef7d022cfe217a94f7a24e5
```

Its first disposable Maritime run stopped before the container entrypoint: Maritime's privileged
`fc-manager` bootstrap attempted to place a provider helper under `/usr/local/bin`, but that parent
directory was absent from the minimal image. The agent and credential were deleted, and no Chrome
pairing occurred.

## Maritime bootstrap filesystem boundary

The bootstrap-compatible candidate adds only an empty `/usr/local/bin` directory through final-stage Docker
metadata. In the immutable image it must be a real root-owned directory with mode `0755`, contain
no file or symlink, and remain outside the application PATH. Vera's application PATH is exactly
`/usr/bin`; the immutable executable inventory remains exactly `/usr/bin/node`. Vera does not ship
BusyBox, a shell, or a provider helper.

`pnpm verify:gateway-image-layout -- --image-ref IMAGE --simulate-bootstrap` validates the
directory, ownership, mode, emptiness, PATH, runtime UID/GID, working directory, entrypoint,
executable allowlist, and banned tool paths. Its simulation creates one fixed harmless helper in an
ephemeral container writable layer as root, inspects only metadata, removes it, and proves the
directory is empty again. The helper is never included in an image or retained as evidence.

During the next live run, Maritime may inject its expected bootstrap helper at runtime. That
provider artifact is distinct from executables shipped in the immutable Vera image. Live evidence
may retain only an opaque helper identifier, SHA-256, owner, group, mode, persistence, PATH
membership, UID `1000` invocation result, and counts of extra executables or symlinks. The helper
bytes must not be copied or retained.

Any unexpected runtime executable, shell or package-manager tool, symlink, PATH expansion, or
material broadening of the UID `1000` application execution surface is
`founder_browser_experimental=no_go`. The manual publication workflow may run only from an exact
commit already merged into `main`; it must reproduce zero findings and verify the runtime layout,
lock hash, signature, source provenance, SBOM, and attestations before one disposable acceptance.

The first bootstrap-compatible candidate was published exactly once from source
`69fee2fcedf7d0474d5a75d64323318b993f7a6a`:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
```

Its publication used Buildx `push: true` and then attempted job-local Docker inspection without
first pulling the immutable digest. Publication therefore stopped before GitHub attestation and
Cosign signing. Anonymous amd64 pull, the shared layout/bootstrap verifier, immutable labels, and
an independent Trivy zero-finding scan pass, but those results do not authorize deployment.

The one permitted recovery accepts the exact existing digest, source commit, and publication run.
It performs no rebuild and no replacement publication. Before registry authentication, it
revalidates the retained runtime lock, anonymously pulls the digest, reruns image identity and
bootstrap checks, generates a fresh SPDX SBOM, and enforces an independent zero-finding scan with
pinned Trivy `0.72.0`. Only then may it create GitHub provenance and SBOM attestations and sign the
same digest with Cosign. `GHCR_PUBLISH_TOKEN` exists only for that terminal workflow run; delete the
temporary secret immediately afterward. A failed recovery does not permit another publication or a
Maritime deployment.

Always delete the temporary secret.

Maritime later proved that both that index and its direct child pulled and unpacked, then failed at
the requested `/sbin/maritime-init` path before Vera's entrypoint. The approved repair restored a
real empty root-owned `/usr/sbin` with `/sbin -> usr/sbin`, embedded no helper, and produced the
current release identity below. The current index passes exact-digest signing and attestation; the
child still requires the no-rebuild direct-child workflow before deployment.

The 2026-08-18 production probe pulled the later signed Gateway digest
`sha256:467cf214919d9487a95bb3d478bcbdf7e55b7a43137588f07b4bbe1f60befe98`
successfully, but Maritime again stopped before Vera's entrypoint with
`Requested init /sbin/maritime-init failed (error -2)`. The current provider path therefore does
not establish bootstrap through the relative `/sbin -> usr/sbin` boundary. The next candidate uses
separate empty root-owned mode-`0755` `/sbin` and `/usr/sbin` directories, keeps both outside
`PATH`, embeds no provider helper, and remains non-deployable until the same signed image passes
live bootstrap and WSS acceptance.

## R3 release-index and runtime-child pull procedure

R3 treats the signed release index identity and selected runtime child identity as different
objects:

```text
release index identity:
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec
runtime child identity:
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8
previous comparison index:
  ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
```

Create
`release-evidence/private/m13a-r3-sbin-bootstrap-20260727-01/` at mode `0700`; every
evidence file is mode `0600`. Never store raw agent IDs, endpoint paths, credentials, signed blob
URLs, provider helper bytes, or raw logs in the sanitized bundle.

Inspect all public runtime objects before any Maritime mutation:

```bash
pnpm inspect:gateway-registry -- \
  --current-index ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec \
  --previous-index ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4 \
  --output release-evidence/private/m13a-r3-sbin-bootstrap-20260727-01/registry-inspection.json
chmod 0600 release-evidence/private/m13a-r3-sbin-bootstrap-20260727-01/registry-inspection.json
```

For an independent child copy, set `R3_OCI_OUTPUT` to a newly created mode-`0700` temporary
directory outside Git. Run the pinned Skopeo image, verify the resulting OCI layout selects the
accepted child manifest, and remove that exact temporary directory:

```bash
docker run --rm \
  -v "$R3_OCI_OUTPUT:/var/lib/vera-output" \
  quay.io/skopeo/stable@sha256:47853bb9fb24202af9110531ebd6e43c5f97701254ca290596640290d17942f4 \
  copy \
  --override-os linux \
  --override-arch amd64 \
  docker://ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8 \
  oci:/var/lib/vera-output/runtime:accepted
```

If the child does not already have a verified signature, SLSA provenance subject, and SPDX SBOM
subject, use the direct-child supply-chain workflow only after its CI-gated merge:

```bash
gh workflow run attest-openclaw-gateway-runtime.yml --ref main \
  -f source_sha=01bc0adc02808dbaf01089d1464ee8db5fe90593 \
  -f release_index_digest=sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec \
  -f runtime_manifest_digest=sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8 \
  -f evidence_run_id=30318064338
```

This workflow performs an anonymous child pull, image-layout check, and independent zero-finding
scan before registry login. It signs and attests the exact existing digest; it performs no build,
no rebuild, no image push, and no replacement publication. Create `GHCR_PUBLISH_TOKEN` without
printing it and delete the temporary secret immediately when the run reaches a terminal state.

### Bounded Maritime A/B/C matrix

Use exactly one private, non-production, custom diagnostic agent. Confirm the installed Maritime
CLI 1.7.0 create/delete syntax immediately before the run. Create it without `--public`, without a
port, browser route, pairing credential, Gateway credential, model credential, environment
secret, or trigger. A later known bootstrap failure is retrieval evidence; API acceptance alone is
not.

Run these deployments sequentially with an operator watchdog enforcing a fifteen-minute terminal
bound for each. Capture sanitized `status`, `info`, `history`, build-log state, UTC start/end,
terminal state, and hashes of opaque provider references after each case:

```bash
# A — previous release index
maritime deploy <private-r3-diagnostic-agent> --source docker --image ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4 --wait
# B — current release index
maritime deploy <private-r3-diagnostic-agent> --source docker --image ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:ecd112fc4a094af6cbbb259ad027bf236ed8f6707cf14fa526455f8003d2dfec --wait
# C — current direct runtime child
maritime deploy <private-r3-diagnostic-agent> --source docker --image ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:628ce0093a6f9443cfd766493ce872edaa60e05d158a4ea6790fe4f26d6780a8 --wait
```

| A/B/C observation                                                  | Required decision                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| A starts, B hangs, C starts                                        | Select C; publish no compatibility image.                                           |
| A starts, B hangs, C hangs for a proven current-child format error | Consider the one compatibility publication only after all preconditions below pass. |
| A, B, and C all hang                                               | Provider/agent/registry incident; publish no image and remain `no_go`.              |
| C reaches `fc-manager` or runtime                                  | Direct-child pull compatibility passes; select C and continue final acceptance.     |

Delete the matrix agent after C or immediately after a fail-closed terminal condition. Confirm the
agent is absent and had zero triggers; destroy the raw ID file. A compatibility publication
requires verified local child execution, successful public-blob verification from founder and
GitHub-hosted environments, a direct-child failure, and a concrete manifest media-type,
compression, or descriptor incompatibility. An undecided cause, timeout, common A/B/C failure, or
provider incident cannot satisfy those preconditions.

If all three approved digests fail on the same agent, the provider escalation contains only UTC
times, CLI version, region when non-sensitive, hashed agent/environment reference, the three
immutable digests, sanitized terminal states, duration, build-log availability, HTTP status class,
request/correlation hashes, zero-trigger confirmation, and cleanup result. Do not include raw IDs,
credentials, endpoint paths, signed object-store URLs, or secret-bearing logs.

The final accepted runtime still needs one separate disposable public Gateway with the exact
`/browser/extension` route, pairing, WSS/subprotocol, origin, bounded payload, stability, shallow
audit, deep audit, and one-tab Chrome consent checkpoint. The matrix agent itself has no public
browser endpoint and cannot satisfy transport acceptance.

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
- The image declares UID/GID `1000:1000`. The Node supervisor refuses root or any other identity,
  accepts only `/data/.openclaw`, rejects symlinked state, and normalizes directories to `0700` and
  files to `0600`. A provider that overrides the image user therefore fails closed and cannot pass
  live acceptance.
- The immutable image contains an empty root-owned mode-`0755` `/usr/local/bin` solely for
  Maritime's privileged pre-entrypoint bootstrap. It is outside application PATH, contains no Vera
  executable, and does not authorize the Node application to invoke provider tooling.
- `remote-extension-route-filter.mjs` listens on public container port `18789`, forwards raw
  upgrades only for exact `/browser/extension`, and denies queries and unrelated routes. The
  general OpenClaw Gateway listens only on loopback port `18790`.

The upstream relay accepts at most 64 MiB per frame. Vera's tool is independently stricter: 64 KiB
for tab inventory, 128 KiB for the raw accessibility snapshot, 32,768 source characters, 24
returned lines, 2,400 returned characters, and a five-second loopback timeout. The hosted Vera
client accepts at most 20 KiB and defaults to a 15-second request timeout.

## Pairing and consent

The pinned OpenClaw 2026.7.1 pairing secret is 32 random bytes encoded as 64 lowercase hexadecimal
characters. It is held in the extension URL fragment at rest
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

Maritime prefixes the intended route with its opaque per-agent path:

```text
wss://api.maritime.sh/a/<opaque-agent-id>/browser/extension
```

Maritime's public documentation does not currently promise WebSocket upgrades, WSS,
`Sec-WebSocket-Protocol` preservation, path filtering, payload limits, idle timeouts, or connection
stability. The repository therefore does not claim those properties and does not authorize a
deployment.

The 2026-07-25 disposable spike proved that plain HTTPS reaches this route (`426 Upgrade Required`)
but WebSocket upgrade attempts with the official Chrome-extension Origin return `403` before
OpenClaw's expected pairing-authentication response. The same result occurs with no token, a wrong
token, and the correct official 64-character token; no `101` or selected relay subprotocol is
observed.

R2 local differential testing corrected the earlier provider-only attribution. Without Maritime,
the correct route returned `101` with the expected protocol and authentication failures returned
the expected `401`/`403`, but an unrelated path also received `101` through OpenClaw's generic
Gateway fallback. The R1 artifact therefore fails route isolation before Maritime is evaluated.
The exact-route and zero-finding runtime repair passes focused tests and local container
acceptance. Its release index and runtime child are published, but the runtime selection and live
transport remain unaccepted. Tests B through D remain blocked.

An operator may repeat the opt-in private probe only after the repaired image is explicitly
approved, published by immutable digest, and passes local Test A:

```sh
VERA_REMOTE_EXTENSION_PROXY_SMOKE=1 \
OPENCLAW_EXTENSION_GATEWAY_URL='wss://api.maritime.sh/a/<opaque-agent-id>/browser/extension' \
OPENCLAW_EXTENSION_PAIRING_SECRET='<private-64-character-lowercase-hex-secret>' \
pnpm test:staging:remote-extension-proxy
```

### Managed pairing bootstrap

The official in-Gateway pairing command remains preferred when the provider offers a safe exec
channel. If a managed provider has no such channel, generate one independent per-user
64-character lowercase hexadecimal value in restricted tooling and inject it only through the
provider's private server setting:

```text
OPENCLAW_EXTENSION_PAIRING_SEED
```

This value must differ from `OPENCLAW_GATEWAY_TOKEN`. The fixed Node supervisor removes the setting
from its own environment before state validation, never passes it to the route-filter or OpenClaw
child, and atomically creates
`/data/.openclaw/credentials/browser-extension-relay.secret` with mode `0600`. A restart is
idempotent only when the existing credential is a regular non-symbolic-link file containing the
same valid value. Malformed input, a mismatching file, an unsafe entry, or a permission failure
prevents Gateway startup.

Do not type the seed into shell history, print it, place it in an image layer, reuse it across Vera
users, or include it in Git or release evidence. The smoke probe shown above intentionally uses a
different variable, `OPENCLAW_EXTENSION_PAIRING_SECRET`, in the restricted operator environment;
that probe variable is not a Gateway container setting.

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
