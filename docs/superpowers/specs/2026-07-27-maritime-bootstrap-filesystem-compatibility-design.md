# Maritime Bootstrap Filesystem Compatibility Repair

**Status:** Approved for implementation on 2026-07-27

## Goal

Produce exactly one replacement Vera OpenClaw Gateway candidate that preserves the reviewed
Milestone 13A architecture and security boundary while adding the empty filesystem location that
Maritime's `fc-manager` requires before the container entrypoint starts. Publish only after local
and CI gates pass, then run exactly one disposable live Maritime acceptance.

This is a filesystem-compatibility repair. It does not add a hosted browser, source adapter,
marketplace discovery, browser interaction, Control UI, additional route, executable, shell,
package manager, or Milestone 13B capability.

## Authoritative baseline

All repository work runs from the isolated worktree:

```text
/private/tmp/vera-founder-staging-evidence-pr
```

The authoritative branch is:

```text
codex/founder-browser-remote-extension
```

The branch is reconciled with `origin/main` before repair work. The previous accepted Gateway
candidate remains immutable:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:69ee4537790f06221487bb0c39c4da91c25dbdbb63fad56be16a1a6de093b7d3
image source revision: 83b65bf4e60f4d1bbef7d022cfe217a94f7a24e5
repository verification commit: bbe88dcf4639acb77709769826a93fe3ffcc9f3c
```

Its runtime identities remain the repair baseline:

```text
OpenClaw: 2026.7.1
OpenClaw source revision: 2d2ddc43d0dcf71f31283d780f9fe9ff4cc04fe4
Chainguard Node base:
cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f
runtime UID/GID: 1000:1000
entrypoint: /usr/bin/node /opt/vera/bin/remote-extension-supervisor.mjs
approved executable allowlist: /usr/bin/node
```

The existing image passed anonymous pull, signature, exact-source provenance, SPDX SBOM,
attestation, and a fresh Trivy `0.72.0` scan with zero `HIGH` and zero `CRITICAL` findings. The
failed live run proved that Maritime stopped in its privileged VM bootstrap before the Vera
entrypoint because `/usr/local/bin` did not exist.

Existing private evidence remains unchanged and gitignored. The repair and acceptance use a new
identifier and new `0700` directories with `0600` files under
`release-evidence/private/`. No private evidence is committed.

## Selected filesystem repair

The final Chainguard stage switches to build-time root metadata, creates `/usr/local/bin` through
Dockerfile `WORKDIR`, and immediately restores the application working directory:

```dockerfile
USER 0:0
WORKDIR /usr/local/bin
WORKDIR /app
```

Docker creates the missing directory without executing `mkdir`, adding a shell, or copying content
from another stage. The resulting directory must be:

- a directory, not a symlink;
- owned by `root:root`;
- mode `0755`;
- empty in the immutable published image; and
- absent from the application `PATH`.

The final environment explicitly sets:

```text
PATH=/usr/bin
```

The image then restores `USER 1000:1000` before its existing entrypoint. The repair does not copy or
install BusyBox. It changes no OpenClaw files, application dependencies, route-filter logic,
supervisor logic, browser plugin, state directory, listener, or port.

## Rejected alternatives

### Copy an empty directory from an intermediate stage

This can work, but it introduces an unnecessary cross-stage copy and creates more opportunities for
unexpected files or ownership to enter the final image. It is less direct than build metadata.

### Wait for Maritime to change `fc-manager`

A provider-side fix would also resolve the root cause, but it is outside this repository and cannot
complete the authorized compatibility repair. Vera still records the provider-injected helper
during live acceptance and stops if it broadens the execution surface.

## Runtime and executable invariants

The published image must retain:

- working directory `/app`;
- numeric runtime identity `1000:1000`;
- entrypoint `["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]`;
- executable allowlist exactly `["/usr/bin/node"]`;
- no `/bin/sh`, BusyBox, Coreutils, curl, Git, npm, pnpm, yarn, Corepack, or package-manager
  library;
- public route-filter listener `0.0.0.0:18789`;
- internal OpenClaw listener `127.0.0.1:18790`;
- internal browser-control listener `127.0.0.1:18792`;
- exact public route `/browser/extension`;
- `openclaw-extension-relay` as the selected successful subprotocol;
- existing pairing, Origin, path, payload, and timeout enforcement; and
- the minimized read-only shared-tab snapshot boundary.

The image metadata version advances by one repair revision. OpenClaw, the Chainguard base, source
image, dependency locks, and every immutable digest remain unchanged.

## Regression validation

Static validation rejects a Dockerfile unless it:

1. creates `/usr/local/bin` through the approved root-owned metadata sequence;
2. restores `WORKDIR /app`;
3. sets `PATH=/usr/bin`;
4. restores `USER 1000:1000`;
5. retains the approved entrypoint, immutable images, and ports; and
6. contains no instruction that copies or installs content into `/usr/local/bin`.

Container-level validation inspects the built `linux/amd64` image and requires:

- `/usr/local/bin` exists and `lstat` reports a directory rather than a symbolic link;
- UID and GID are both zero;
- mode is exactly `0755`;
- directory contents are empty;
- no executable exists below it;
- `PATH` is exactly `/usr/bin`;
- runtime UID/GID is `1000:1000`;
- working directory and entrypoint match the approved values; and
- `/usr/bin` contains only `node`.

A simulated provider-bootstrap test starts an ephemeral copy of the locally built image with an
explicit root override. Using `/usr/bin/node`, it creates one temporary non-secret helper file
inside `/usr/local/bin`, verifies the file can be created because the parent exists, records only
its metadata in test output, removes it, and proves the directory is empty again. The helper exists
only in the disposable container writable layer and never enters an image, source file, fixture, or
evidence artifact.

Existing unit, route-isolation, local WebSocket, subprotocol, proxy, snapshot, and supervisor tests
remain unchanged except where they gain assertions for these invariants. CI, release, and
attestation workflows perform the same runtime-layout validation so a locally passing but
publication-incompatible image cannot proceed.

## Supply-chain and PR gate

Before pushing the repair:

1. Run formatting, lint, typecheck, focused Gateway tests, the full required repository tests,
   PostgreSQL tests, and production builds.
2. Build the `linux/amd64` image locally without publication.
3. Run the runtime-layout and simulated-bootstrap checks.
4. Run local route-isolation, WebSocket, transport, snapshot, and supervisor tests.
5. Run Trivy `0.72.0` with no ignore file and require zero `HIGH` and zero `CRITICAL` findings.
6. Confirm the executable inventory contains only `/usr/bin/node`.
7. Scan the diff and generated test output for secrets and private evidence.
8. Run `git diff --check`.

The focused PR title is:

```text
fix: add Maritime bootstrap filesystem compatibility
```

The PR explains the pre-entrypoint failure, the empty-directory-only repair, the absence of
BusyBox and shell tooling, the provider's runtime helper injection, and the live helper inspection
boundary. It merges only when required CI passes on the exact head and GitHub reports it mergeable.

## Single replacement publication

After merge, the manual Gateway workflow publishes exactly one replacement from the exact merged
source commit. A temporary lookup tag may locate the output, but every scan, deployment, and
evidence record uses:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:<new-registry-digest>
```

Publication must independently establish:

- anonymous pull;
- exact immutable registry digest;
- exact merged source revision;
- zero Trivy `HIGH` or `CRITICAL` findings;
- SPDX SBOM bound to the digest;
- SLSA provenance bound to the digest and source;
- Cosign signature;
- attestation binding;
- unchanged OpenClaw and Chainguard identities;
- empty root-owned `/usr/local/bin`;
- PATH `/usr/bin`; and
- executable allowlist exactly `["/usr/bin/node"]`.

Any temporary publication credential is deleted immediately after the workflow reaches a terminal
state. A failure permits no second replacement candidate.

## Disposable Maritime acceptance

Only a fully passing published candidate may enter one live acceptance run. The run creates exactly
one disposable, public, always-on custom Gateway on port `18789`, with one fresh temporary Gateway
credential, zero triggers, no model credentials, and no additional capability.

Before Chrome pairing, acceptance requires:

1. `fc-manager` bootstrap succeeds.
2. The VM and Gateway reach ready state.
3. The Node supervisor runs as UID/GID `1000:1000`.
4. The three listeners have exactly the approved addresses and ports.
5. No unexpected public listener or Control UI exists.
6. Unrelated routes return `404`.
7. The provider helper is the only runtime-injected executable.

The provider helper is never copied or retained. Sanitized evidence records only an opaque filename
or identifier, SHA-256, owner, group, mode, persistence after bootstrap, PATH membership, whether
UID `1000` can invoke it, and whether any extra executable or symlink appeared. Any unexpected
shell, package-manager tool, symlink, executable, PATH expansion, or material application execution
surface stops acceptance as `no_go`.

## Transport, Chrome, and security acceptance

Only after bootstrap acceptance passes may transport tests verify HTTPS, exact and unrelated HTTP
and WebSocket routes, wrong-secret denial, correct `101`, selected
`openclaw-extension-relay`, accepted and rejected Origins, subprotocol preservation, ping/pong,
bounded stability, payload limits, safe timeouts, and secret-free logs.

Only after transport passes may the founder manually pair the reviewed official extension using a
fresh credential that is never printed or persisted. Exactly one inert `https://example.com/` tab
is shared. Vera requests exactly one minimized read-only snapshot and performs no navigation,
clicking, typing, form use, upload, download, screenshot retention, cookie access, storage access,
history access, or unrelated-tab access. Unsharing must make the next snapshot fail with
`no_shared_tab`, after which pairing is revoked.

The live run then performs shallow and deep OpenClaw audits, wrong-secret and revoked-secret tests,
pairing replay denial, restart/reconnect, prompt-injection inert-page handling, forbidden-action
denial, unrelated-route and Control UI checks, runtime executable inventory, and secret/log scans.

## Evidence and cleanup

The new private bundle binds the immutable replacement digest, merged source revision, OpenClaw and
extension versions, Maritime environment reference hash, execution time, and
`founder_browser_experimental` profile. It contains strict allowlisted records, sanitized external
references and hashes, per-record content hashes, and a canonical bundle SHA-256. It never contains
raw credentials, agent IDs, endpoints, headers, browser content, profile paths, screenshots,
cookies, storage, history, or provider-helper bytes.

Whether acceptance passes or fails:

- every tab is unshared;
- the extension is unpaired;
- temporary credentials and files are removed;
- the disposable agent is deleted and absent from inventory;
- its former endpoint returns `404`;
- no trigger or temporary Actions secret remains;
- only sanitized private evidence is preserved; and
- the repository worktree is clean.

## Decision

The result is `passed_13a` only when the replacement image passes every supply-chain gate, Maritime
bootstrap and helper acceptance pass, correct WSS returns `101` with the expected subprotocol, the
extension produces one minimized snapshot from one explicitly shared inert tab, unsharing revokes
access, all security audits pass, evidence validates, and disposable infrastructure is removed.

Any failure returns:

```text
founder_browser_experimental=no_go
```

with the smallest remaining repair. Milestone 13B remains unauthorized in every outcome of this
task.
