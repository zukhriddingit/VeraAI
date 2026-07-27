# Milestone 13A-R3 Maritime Image-Pull Compatibility

**Status:** Approved for implementation on 2026-07-27

## Goal

Determine why Maritime did not finish pulling the current hardened Vera OpenClaw Gateway, select
the smallest immutable runtime identity that Maritime can retrieve, and complete Milestone 13A
without changing application or browser behavior.

The required architecture remains:

```text
Chrome extension
  -> direct WSS
  -> Maritime public edge
  -> exact /browser/extension route filter
  -> hardened OpenClaw Gateway
  -> explicitly shared Chrome tab
```

This work does not add a hosted browser, source adapter, rental-site discovery, OpenClaw
capability, landing-page change, or Milestone 13B behavior.

## Authoritative baseline

All repository work uses the isolated worktree:

```text
/private/tmp/vera-founder-staging-evidence-pr
```

The R3 branch starts from merged main:

```text
branch: codex/maritime-image-pull-r3
main SHA: 58355ad24c3ec10a0061b849c61a8aa403958108
```

The current signed release index is:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@
sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
source revision: 69fee2fcedf7d0474d5a75d64323318b993f7a6a
```

The previous index that Maritime pulled far enough to reach its old bootstrap failure is:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@
sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3
```

The current index already passed anonymous public pull, Cosign verification, SLSA provenance,
SPDX SBOM verification, exact image-layout checks, and a Trivy `0.72.0` scan with zero `HIGH` and
zero `CRITICAL` findings. The failed R2 live run proved only that Maritime left the deployment in
`building` for more than twenty minutes. It produced no runtime, helper, listener, WSS, Chrome, or
security-audit evidence.

Previous private evidence remains unchanged and gitignored. R3 uses the distinct identifier:

```text
m13a-r3-maritime-image-pull-20260727-01
```

R3 directories use mode `0700`; evidence files use mode `0600`.

## Initial structural finding

Read-only inspection established the following before design approval.

### Current release index

```text
media type: application/vnd.oci.image.index.v1+json
linux/amd64 child:
  sha256:bfc514cf3c0f54def310459b67ea15fb4a1c4ff66ff9ab2d01d9c24445febd0a
attestation manifest:
  sha256:754047bc012640e17a9022fc2c1c134f317348d023d0a2a3b0c47bbc2d5433da
runtime layers: 17
compressed runtime bytes: 296050552
runtime layer media type: application/vnd.oci.image.layer.v1.tar+gzip
config:
  sha256:2fed5208328d4f477f73474a7baf2400694ad67f38a8ef0742e8eb16fbd7c95f
```

### Previous release index

```text
media type: application/vnd.oci.image.index.v1+json
linux/amd64 child:
  sha256:62c69245870f2884e28281e80f4422eb391bce9c269e35d468bb1d20be315e42
attestation manifest:
  sha256:55791019a98232f8fe662bd58cad0b8b7cc9f63c10fded449a84b43d046db878
runtime layers: 16
compressed runtime bytes: 296050492
runtime layer media type: application/vnd.oci.image.layer.v1.tar+gzip
config:
  sha256:4ff3312be67a3c4b424f10e1f607a15b2aec680d46332b0ddb1d3ad7cfec716b
```

Each index contains exactly one runnable `linux/amd64` descriptor and one `unknown/unknown`
descriptor annotated as `vnd.docker.reference.type=attestation-manifest`. Both runtime children
are OCI image manifests containing standard gzip-compressed OCI layers. There is no zstd layer,
multiple runnable platform, or meaningful image-size increase.

Because the previous provider-pullable release used the same top-level index and attestation
shape, R3 does not assume that OCI indexes or embedded BuildKit attestations are generically
unsupported. The Maritime pull matrix must distinguish an index-specific issue from a
current-blob issue and an agent-specific provider incident.

## Selected approach

Use a direct-child-first, evidence-gated decision tree:

1. Inspect both indexes and runtime children through Docker Buildx and an independent Registry API
   V2 client.
2. Verify the current top-level index, `linux/amd64` child, config, and every runtime layer from
   founder infrastructure and a GitHub-hosted runner.
3. Produce a deterministic parent-index-to-runtime-child binding record.
4. Run one disposable private Maritime diagnostic agent through the bounded sequence:
   previous index, current index, current child.
5. Accept the existing child digest as the deployment runtime identity if it reaches
   fc-manager/runtime and has direct supply-chain binding.
6. Publish one compatibility image only when the direct child is valid locally but Maritime proves
   it cannot retrieve that manifest or its blobs because of a demonstrated media-type or
   compression incompatibility.
7. Treat all three digests hanging on the same agent as a provider/agent/registry incident, not as
   an image defect.

The deployment timeout is exactly fifteen minutes per matrix case. API acceptance is not success.
Each case needs a terminal deployment result or observable runtime startup.

## Rejected approaches

### Proactively republish a Docker-V2 image

This would consume the one allowed compatibility publication before proving the image shape is
the failure. It also creates a new immutable identity when the existing child may already work.

### Treat the current index as defective from structure alone

The previous pullable index has the same OCI index, runnable-platform count, and BuildKit
attestation descriptor pattern. Structure alone does not support this conclusion.

### Retry unbounded deployments

Unbounded or repeated pulls obscure whether a case reached a terminal state and can leave
disposable infrastructure running. R3 uses one attempt per approved digest per matrix agent.

### Remove supply-chain evidence

Attestations may move outside a pull-critical runtime manifest if a compatibility image is
required, but signatures, exact-source provenance, SPDX SBOM, and zero-finding evidence remain
mandatory and bind the exact deployed digest.

## Registry inspection boundary

A focused TypeScript registry inspector retrieves public GHCR objects without credentials or
Docker daemon state. It:

- obtains an anonymous GHCR bearer token scoped only to pull the public package;
- fetches a requested manifest with an explicit OCI/Docker Accept allowlist;
- preserves and verifies the `Docker-Content-Digest`;
- distinguishes image indexes, runnable image manifests, and attestation manifests;
- rejects more or fewer than one runnable `linux/amd64` descriptor;
- fetches the child manifest and configuration;
- HEADs and GETs every runtime layer with redirects enabled only to HTTPS;
- computes SHA-256 while streaming each bounded object;
- compares declared and observed lengths when both exist;
- records media type, descriptor size, response status, and bounded duration;
- classifies `unknown/unknown` attestation descriptors without treating them as runtime layers;
- rejects zstd and nonstandard runtime layer media types; and
- never retrieves an attestation blob as a runtime layer.

The output is a closed, sanitized JSON document with no bearer token, authorization header,
redirect URL, signed object-store query, raw response header set, or local path.

A second local inspection uses `docker buildx imagetools inspect --raw`. A pull-request CI job on
`ubuntu-24.04` repeats the independent public-object verification, so founder-network success
cannot be the only evidence.

## Structural diff and binding record

The registry inspector emits normalized image structures. A pure diff function compares:

- top-level media type;
- runnable and attestation descriptor counts;
- descriptor media types, sizes, platforms, and annotations;
- child media type;
- configuration digest and size;
- layer count and total compressed size;
- ordered layer digests, sizes, media types, and compression; and
- rootfs diff IDs from the image configuration.

The parent-index-to-runtime-child binding record contains only:

```text
schema version
release index digest
linux/amd64 runtime manifest digest
descriptor media type
platform os and architecture
source revision
image config digest
ordered rootfs diff IDs
SBOM subject digest
provenance subject digest
signature verification result
content hash
```

The record is canonically serialized and SHA-256 hashed. Validators reject extra fields, mutable
tags, non-amd64 platforms, mixed source identities, missing subjects, an unverified signature,
and a content-hash mismatch.

The signed release index must reference the exact child descriptor. Existing Cosign, provenance,
and SBOM evidence is inspected to determine its subjects. If the child lacks its own signature,
sign exactly that existing child digest without rebuilding or pushing image content. If the
existing SBOM or provenance does not name the child, attach one exact SPDX SBOM and one
non-falsified SLSA predicate using the already-verified source and build data. Every registry write
requires the temporary package credential and occurs only after read-only verification passes.
The temporary secret is deleted immediately afterward.

## Bounded Maritime pull matrix

The first disposable agent is a non-production, non-public, custom diagnostic agent with:

- no browser route;
- no pairing credential;
- no Gateway credential;
- no model credential;
- no trigger; and
- a fixed fifteen-minute timeout per case.

The same agent runs these immutable digests sequentially:

```text
A. previous release index
B. current release index
C. current linux/amd64 child manifest
```

For each case, R3 captures sanitized `status`, `info`, `history`, provider build-log state,
start/completion timestamps, and opaque deployment-reference hashes. Raw agent IDs, endpoint
paths, credentials, and provider object-store URLs never enter committed files or sanitized
evidence.

Interpretation is fixed:

| Matrix result | Decision |
| --- | --- |
| A pulls, B hangs, C starts | Use the current child as runtime identity; no new image |
| A pulls, B hangs, C hangs | Inspect current child blob/media behavior; compatibility only on demonstrated format failure |
| A also hangs | Provider/agent/registry incident; no image change |
| C reaches fc-manager or runtime | Child-manifest pull compatibility passes |

The matrix agent is deleted after the third case or immediately after a fail-closed terminal
condition. Its absence, former endpoint status when applicable, and zero-trigger state are
recorded.

## Conditional compatibility image

Compatibility publication is unreachable unless all of these are true:

1. the current child verifies and runs locally;
2. every public registry object verifies from both environments;
3. the Maritime matrix proves direct-child retrieval still fails;
4. the failure is tied to a concrete manifest media type, compression, or descriptor shape; and
5. the compatibility format is the smallest repair supported by that evidence.

The one allowed compatibility candidate preserves the current approved application filesystem and
configuration while exporting:

```text
platform: linux/amd64
top-level media type: application/vnd.docker.distribution.manifest.v2+json
runtime layer media type: application/vnd.docker.image.rootfs.diff.tar.gzip
compression: gzip
force-compression: true
embedded exporter provenance: false
embedded exporter SBOM: false
```

The build uses immutable source and base digests and retains the exact OpenClaw version,
entrypoint, working directory, UID/GID, PATH, ports, executable allowlist, supervisor, route
filter, browser plugin, and security configuration. Before push, validators compare the source
tree, application-content hashes, image configuration, rootfs contents, and runtime invariants
against the current approved child.

Separate Cosign signature, SLSA provenance, SPDX SBOM, and Trivy zero-finding evidence bind the
compatibility digest. Disabling exporter-embedded attestations changes only the pull-critical
manifest shape; it does not reduce supply-chain coverage.

If this compatibility digest still fails on one new diagnostic agent, R3 tests one small public
Docker Hub image and one small public GHCR image on that same agent and emits the exact sanitized
provider escalation. No second compatibility image is allowed.

## Local and CI validation

The focused implementation uses table-driven tests for:

- one and only one runnable `linux/amd64` descriptor;
- correct attestation-manifest classification;
- OCI and Docker-V2 manifest parsing;
- gzip acceptance and zstd rejection;
- config and layer digest verification;
- length mismatch and missing-blob rejection;
- unsafe redirect rejection;
- bounded duration recording;
- deterministic previous/current diff;
- parent-index-to-child content hashing;
- closed binding-record fields;
- direct-child subject binding;
- compatibility-workflow reachability only after demonstrated need;
- exactly one compatibility publication;
- exporter attestations disabled only for the compatibility runtime shape;
- separate signature, provenance, SBOM, and zero-finding gates;
- immutable image references only;
- no deployment from CI/release workflows;
- no secret-bearing diagnostic output; and
- unchanged Gateway runtime and route invariants.

Validation includes formatting, lint, typecheck, focused tests, full required unit and integration
tests, PostgreSQL tests, production builds, image-layout checks, simulated provider bootstrap,
route isolation, local WebSocket and subprotocol tests, official-extension local snapshot,
Trivy zero-finding scan, executable inventory, secret scan, and `git diff --check`.

Repository changes use one focused CI-gated PR. No publication or Maritime operation occurs until
the exact PR head passes required CI, GitHub reports it mergeable, and it is merged to main.

## Final live acceptance

Once the matrix or compatibility diagnostic proves a runtime digest reaches ready state, create
one final disposable always-on public Gateway on port `18789`. It has one fresh Gateway credential,
zero triggers, and no model credential.

Before Chrome pairing, require:

- fc-manager bootstrap completion;
- Node supervisor at UID/GID `1000:1000`;
- route filter at `0.0.0.0:18789`;
- OpenClaw at `127.0.0.1:18790`;
- browser control at `127.0.0.1:18792`;
- no unexpected public listener;
- no Control UI;
- unrelated HTTP and WebSocket denial;
- wrong-secret denial;
- correct `101`;
- `openclaw-extension-relay` selection;
- valid and invalid Origin enforcement;
- preserved subprotocol;
- ping/pong;
- bounded stability;
- payload and timeout enforcement;
- shallow and deep security audits; and
- secret-free logs.

The process then pauses for the founder's manual Chrome checkpoint. The reviewed official
extension is loaded manually, paired with a fresh clipboard-only string, and shares exactly one
inert `https://example.com/` tab. After the founder confirms sharing, Vera requests exactly one
minimized read-only snapshot, performs no interaction, unshares the tab, verifies
`no_shared_tab`, and revokes pairing.

## Evidence and cleanup

The new private R3 bundle binds:

- signed release index when used;
- exact deployed runtime manifest digest;
- source revision;
- OpenClaw `2026.7.1`;
- official extension `2.0.0`;
- Maritime environment reference hash;
- execution timestamps;
- `founder_browser_experimental`; and
- hashes of registry, matrix, transport, audit, snapshot, revocation, and cleanup observations.

The bundle uses strict allowlisted records, per-record content hashes, canonical serialization,
and a deterministic bundle SHA-256. It contains no credentials, raw headers, redirect URLs,
provider request IDs, raw agent IDs, endpoints, browser snapshots, browser profile paths, helper
bytes, cookies, storage, history, emails, phone numbers, or private registry responses.

Whether R3 passes or fails:

- unshare all tabs;
- unpair the extension;
- revoke temporary credentials;
- delete every disposable agent;
- confirm former public endpoints return `404`;
- confirm trigger count is zero;
- delete temporary files and Actions secrets;
- preserve only sanitized private evidence;
- leave previous evidence unchanged;
- leave no private evidence tracked; and
- leave the isolated worktree clean.

## Decision

Return `passed_13a` only when the exact deployed runtime digest has verified supply-chain evidence,
Maritime pulls and starts it, correct WSS returns `101` with the required subprotocol, the official
extension returns one minimized snapshot from one explicitly shared inert tab, unsharing revokes
access, shallow and deep audits pass, the evidence bundle validates, and disposable
infrastructure is gone.

Every other result is:

```text
founder_browser_experimental=no_go
```

with the exact smallest remaining boundary. Milestone 13B is not authorized by this work.
