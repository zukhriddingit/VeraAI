# Maritime `/sbin` Bootstrap Compatibility Repair

**Status:** Approved for implementation on 2026-07-27

## Goal

Produce exactly one replacement Vera OpenClaw Gateway candidate that preserves the reviewed
Milestone 13A architecture and security boundary while restoring the conventional `/sbin` and
`/usr/sbin` filesystem shape required for Maritime's provider-injected
`/sbin/maritime-init`. Publish and run one disposable live acceptance only after every local,
CI, vulnerability, signing, provenance, and SBOM gate passes.

This is a pre-entrypoint filesystem compatibility repair. It does not change OpenClaw behavior,
the route filter, the Node supervisor, browser behavior, ports, source discovery, or any
Milestone 13B capability.

## Authoritative evidence

The current signed release index and exact `linux/amd64` runtime child both pass anonymous
registry retrieval, full blob verification, local image-layout validation, and a fresh Trivy
scan with zero `HIGH` and zero `CRITICAL` findings. Maritime pulled and unpacked both images,
then the Firecracker guest failed before Vera's entrypoint:

```text
release index:
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
linux/amd64 runtime:
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a
image source revision:
69fee2fcedf7d0474d5a75d64323318b993f7a6a
repository verification baseline:
be87497a55454eafacea7bbdc55abe2d2ef3f439
```

The terminal provider failure was:

```text
Requested init /sbin/maritime-init failed (error -2)
```

A successful Maritime-managed OpenClaw image and the reviewed upstream OpenClaw `2026.7.1`
image both use:

```text
/sbin -> usr/sbin
/usr/sbin    real root-owned directory
```

The hardened Chainguard runtime currently uses:

```text
/sbin -> usr/bin
/usr/sbin -> bin
```

An ephemeral local simulation against the exact hardened child removed those two symlinks,
created an empty root-owned `/usr/sbin`, restored `/sbin -> usr/sbin`, placed a disposable
root-owned `0500` probe at `/usr/sbin/maritime-init`, and proved that
`/sbin/maritime-init` resolved. The probe was removed and the directory returned to empty.
This strongly isolates the remaining boundary to provider-bootstrap filesystem layout; it is
not an OCI index, media-type, compression, descriptor, layer, blob, or application failure.

## Selected repair

Extend the existing build-time Node filesystem-pruning instruction in the final Chainguard
stage. While the build identity is `root`, it must:

1. remove the inherited `/sbin` and `/usr/sbin` symlinks;
2. create `/usr/sbin` as a real directory;
3. set its owner to `0:0` and mode to `0755`;
4. create `/sbin` as the relative symlink `usr/sbin`; and
5. continue the existing `/usr/bin` pruning so `node` remains the only application
   executable there.

The immutable image must not contain `maritime-init` or any other provider helper. Maritime
remains responsible for injecting its disposable helper at deployment time.

The final image continues to have:

- OpenClaw `2026.7.1` from the existing immutable source digest;
- the existing immutable Chainguard Node base digest;
- runtime UID/GID `1000:1000`;
- `PATH=/usr/bin`;
- working directory `/app`;
- entrypoint `["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]`;
- public route-filter listener on `18789`;
- loopback OpenClaw listener on `18790`;
- loopback browser-control listener on `18792`; and
- the exact public `/browser/extension` route only.

The existing empty root-owned `/usr/local/bin` compatibility directory remains unchanged and
outside `PATH`.

## Alternatives rejected

### Copy `/sbin` and `/usr/sbin` from the upstream OpenClaw stage

This could copy unrelated system files or executables into the minimal final image and weaken
the reviewed executable inventory. The required layout can be created directly without copying
content.

### Embed a replacement `/sbin/maritime-init`

The provider owns this helper and its protocol. Shipping a Vera implementation would invent
provider behavior, add an immutable executable, broaden the attack surface, and hide rather than
fix the injection boundary.

### Publish another manifest-format compatibility image

Both the OCI release index and its direct child already pulled and unpacked. A Docker V2/gzip
re-export would not address the observed pre-entrypoint path failure and is therefore not
permitted by the evidence.

## Validation

Static validators must reject the Dockerfile unless the final stage contains the exact
root-only normalization, retains `/usr/local/bin`, restores `USER 1000:1000`, and does not copy
or add provider helpers.

The image-layout verifier must require:

- `/sbin` is a symlink whose target is exactly `usr/sbin`;
- `/usr/sbin` is a real root-owned `0755` directory;
- `/usr/sbin` is empty in the immutable image;
- `/usr/local/bin` remains a real root-owned empty `0755` directory;
- runtime UID/GID, working directory, `PATH`, entrypoint, and `/usr/bin` inventory remain
  unchanged; and
- no banned shell, package-manager, or utility path appears.

The bootstrap simulation must run as root in a disposable container layer, create a
non-secret `0500` probe at `/usr/sbin/maritime-init`, resolve it through
`/sbin/maritime-init`, remove it, and prove `/usr/sbin` is empty afterward.

All existing transport, route-isolation, WSS, subprotocol, supervisor, snapshot, release
workflow, registry, and supply-chain tests remain required. The locally built `linux/amd64`
image must pass the layout verifier and Trivy `0.72.0` with zero `HIGH` and zero `CRITICAL`
findings before any remote operation.

## Publication and live acceptance

The focused PR may merge only when required CI passes on its exact head and GitHub reports it
mergeable. After merge, publish exactly one replacement candidate from the merged source SHA.
Every subsequent operation uses its immutable digest.

The candidate must pass anonymous pull, layout verification, exact source binding, Cosign
signature, SLSA provenance, SPDX SBOM, and zero-finding Trivy evidence. Failure at any gate
prevents Maritime deployment.

Create exactly one disposable public always-on Maritime Gateway with no triggers and one fresh
temporary pairing credential. Require provider bootstrap, Vera supervisor startup, route
filter, OpenClaw, browser-control startup, unrelated-route denial, wrong-secret denial, correct
`101`, preserved subprotocol, Origin checks, ping/pong, bounded stability, payload and timeout
enforcement, and shallow/deep security audits.

At the manual Chrome checkpoint, the founder loads the reviewed official extension, pairs over
WSS, shares exactly one `https://example.com/` tab, and confirms. Vera then requests one
minimized read-only snapshot, verifies no interaction occurred, confirms `no_shared_tab` after
unsharing, revokes pairing, deletes the agent, confirms the endpoint is gone, and records zero
triggers.

## Evidence and classification

All new real evidence uses a distinct identifier under gitignored
`release-evidence/private/`, with directories mode `0700` and files mode `0600`. It binds the
exact source SHA, release index, deployed runtime manifest, configuration digest, OpenClaw
version, extension version, Maritime execution timestamps, and sanitized external references.
No prior evidence file is modified.

Return `passed_13a` only when the immutable replacement starts on Maritime, all WSS and Chrome
consent-tab checks pass, audits pass, evidence validates, credentials are revoked, and all
disposable infrastructure is gone. Otherwise return
`founder_browser_experimental=no_go` with the exact remaining boundary. Milestone 13B remains
unauthorized.
