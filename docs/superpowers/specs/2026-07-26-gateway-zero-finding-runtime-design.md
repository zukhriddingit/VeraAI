# Gateway Zero-Finding Runtime Repair

**Status:** Approved for implementation on 2026-07-26

## Goal

Produce one replacement Vera OpenClaw Gateway candidate that preserves the reviewed OpenClaw
`2026.7.1` remote-extension behavior while reducing the final linux/amd64 image to zero Trivy
`HIGH` or `CRITICAL` findings. Publish only after the local transport, isolation, identity, and
supply-chain gates pass. Deploy to Maritime only after the published image also passes signing,
provenance, SBOM, attestation, and zero-finding verification.

This is a security-only repair. It does not broaden browser capabilities, change the consent model,
add marketplace discovery, enable navigation or interaction, expose the Control UI, begin
Milestone 13B, or weaken any release gate.

## Authoritative baseline

All work runs from the isolated worktree:

```text
/private/tmp/vera-founder-staging-evidence-pr
```

The authoritative branch is:

```text
codex/founder-browser-remote-extension
```

The reviewed OpenClaw application behavior comes from the immutable upstream image:

```text
ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c
OpenClaw version: 2026.7.1
```

The rejected Vera candidate remains immutable and is never deployed:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5d1f6d2d097bb8e53f2e2dd6c1e6f8499d6daf34dff8a61b9b0c187fd9e1ec6b
source commit: d433dea39abedfb6aef96bf7146a85cb8f4ae843
publication run: 30233249694
```

Its private scan evidence remains gitignored under
`release-evidence/private/m13a-r2-live-20260727-publication-30233249694/` with directory mode
`0700` and file mode `0600`. The scan found 23 `CRITICAL` and 98 `HIGH` findings. Ninety-eight
findings came from the Debian runtime and 23 came from Node packages.

## Selected architecture

Use a multi-stage image:

1. The immutable OpenClaw `2026.7.1` image supplies only the reviewed `/app` application runtime.
2. A build-only sanitizer replaces a closed allowlist of vulnerable Node package instances with
   integrity-pinned fixed patch releases.
3. A build-only layout stage assembles Vera configuration, plugins, state directories, and the
   Node supervisor with numeric ownership `1000:1000`.
4. The final image uses this immutable linux/amd64 Chainguard Node base:

   ```text
   cgr.dev/chainguard/node@sha256:09e6c4bd94200c4866fb18168e666b03de98a9908f55badab29388e80e8b622f
   ```

5. The final image copies only the sanitized OpenClaw runtime and the Vera runtime layout. It does
   not copy Corepack, pnpm, package-manager caches, Git, curl, Python, Perl, a shell, or unrelated
   operating-system utilities.

The pinned Chainguard amd64 base reports zero Trivy `HIGH` or `CRITICAL` findings with Trivy
`0.72.0`. Its Node runtime is within OpenClaw `2026.7.1`'s declared engine range. The final image
runs as numeric UID/GID `1000:1000` even though the upstream base has a different default identity.

## Dependency repair boundary

The sanitizer may replace only these vulnerable `/app` runtime packages and versions:

| Package | Rejected installed versions | Fixed version |
| --- | --- | --- |
| `@opentelemetry/propagator-jaeger` | `2.8.0` | `2.9.0` |
| `@vitest/browser` | `4.1.9` | `4.1.10` |
| `brace-expansion` | `5.0.7` | `5.0.8` |
| `fast-uri` | `3.1.2` | `3.1.4` |
| `postcss` | `8.5.16` | `8.5.18` |

The rejected image's remaining Node findings occur only below npm or Corepack/pnpm:

- npm: `brace-expansion@5.0.5`, `sigstore@4.1.0`, `tar@7.5.13`, and `undici@6.25.0`;
- Corepack/pnpm: `pnpm@11.2.2`, `tar@7.5.15`, and `undici@6.25.0`.

The final image omits npm, Corepack, and pnpm instead of updating their private dependency graphs
because package management is not a Gateway runtime capability. The clean application instances
`tar@7.5.19`, `undici@8.5.0`, and jsdom's `undici@7.28.0` remain unchanged. Each replacement
tarball is pinned by package name, exact version, registry URL, and registry integrity value in a
committed lock file.

The sanitizer must:

- discover every installed instance by package name and version;
- reject an unexpected vulnerable version;
- reject a missing expected instance;
- reject an unexpected instance count;
- verify the downloaded tarball integrity before extraction;
- replace the complete package directory rather than overlaying partial files;
- retain no tarball, package-manager cache, or sanitizer tooling in the final image; and
- fail if a replacement introduces an undeclared runtime dependency or changes the package name.

No vulnerability ignore file, VEX suppression, severity downgrade, `--ignore-unfixed`, or scanner
exclusion may satisfy the zero-finding gate.

## Node supervisor

Replace the shell entrypoint with one focused Node supervisor. Before starting the existing route
filter, it must:

- require `OPENCLAW_STATE_DIR=/data/.openclaw`;
- require effective UID and GID `1000`;
- reject symlinked `/data` or state-directory boundaries;
- create only the expected state, credential, and workspace directories;
- apply mode `0700` to those directories and mode `0600` to existing files;
- set process umask `0077`;
- launch only the fixed route-filter command;
- forward `SIGINT` and `SIGTERM`;
- propagate the child exit code or signal; and
- emit no secrets, paths outside the fixed state boundary, or browser content.

The image-level `USER 1000:1000` is mandatory. A runtime override to root or another identity must
fail closed rather than attempting an in-container privilege transition.

## Preserved application and network behavior

The repair retains:

- OpenClaw `2026.7.1`;
- public listener `0.0.0.0:18789`;
- exact accepted route `/browser/extension`;
- internal Gateway `127.0.0.1:18790`;
- eager browser-control service `127.0.0.1:18792`;
- `OPENCLAW_EAGER_BROWSER_CONTROL_SERVER=1`;
- `OPENCLAW_HEADLESS=true`;
- the existing route, Origin, pairing, and subprotocol checks;
- the existing minimized read-only snapshot plugin;
- disabled Control UI, channels, commands, browser actions, and external side effects; and
- one explicitly shared tab as the only browser consent boundary.

No Chromium or hosted browser binary is installed in the Gateway. Browser execution remains in the
founder's reviewed Chrome extension.

## Immutable supply-chain record

A committed runtime lock records:

- OpenClaw version and immutable source-image digest;
- Chainguard image index and linux/amd64 child digest;
- expected Node major/version constraint;
- every repaired package's rejected versions, fixed version, tarball URL, and integrity;
- pinned Trivy version;
- expected UID/GID;
- expected entrypoint; and
- final public and internal ports.

Static verification rejects mutable image references, a missing integrity value, an unapproved
dependency replacement, a shell-based final entrypoint, package-manager or system-tool leakage,
identity drift, and any relaxation of the zero-finding scan.

## Validation

Before creating the repair PR:

1. Unit-test the dependency lock, sanitizer allowlist, Node supervisor, Dockerfile boundary, and
   static workflow checks.
2. Build the linux/amd64 image locally from committed source.
3. Run the existing route-filter, websocket transport, proxy, and minimized-snapshot tests.
4. Verify unrelated paths return `404`, bad pairing returns `401`, approved pairing returns `101`,
   `openclaw-extension-relay` is selected, ping/pong works, and the bounded connection remains
   stable.
5. Verify the final process runs as UID/GID `1000`.
6. Verify the expected entrypoint, environment, ports, source labels, and immutable base metadata.
7. Run Trivy `0.72.0` with vulnerability database updates enabled, no ignore file, both fixed and
   unfixed findings included, severities `HIGH,CRITICAL`, and `--exit-code 1`.
8. Require zero reported findings.
9. Run formatting, lint, typecheck, affected tests, the full test suite, PostgreSQL tests, and
   production builds.
10. Review the diff for capabilities, secrets, evidence leakage, mutable references, and unrelated
    changes.

The PR is merged only after GitHub reports it mergeable and every required check passes.

## Replacement publication

Only one replacement registry candidate may be published. Local builds do not count as
publication.

After the repair PR is merged:

1. Bind the publication to the exact merged source commit.
2. Create the temporary `GHCR_PUBLISH_TOKEN` Actions secret by passing the authorized credential on
   stdin; never use `--body -`.
3. Dispatch the manual Gateway release workflow once.
4. Delete the temporary secret immediately when the run reaches any terminal state.
5. Require zero `HIGH` or `CRITICAL` scan findings.
6. Require an SBOM bound to the immutable image digest.
7. Require signature verification, exact-source provenance, and registry attestations.
8. Record the immutable replacement digest separately from its temporary lookup tag.

If build, scan, signing, provenance, SBOM, or attestation fails, retain
`founder_browser_experimental=no_go`, publish no further replacement, and do not deploy.

## Maritime boundary

Maritime deployment is outside this repair unless every replacement-publication gate passes. A
passing publication permits only the previously approved disposable Milestone 13A acceptance
agent. It does not authorize a permanent Gateway, product deployment, marketplace browsing,
Milestone 13B, or broader browser capabilities.

## Completion

The security repair is complete only when:

- the final local and published images both have zero Trivy `HIGH` or `CRITICAL` findings;
- the existing transport and route-isolation behavior passes unchanged;
- runtime UID/GID is `1000:1000`;
- all source, base, dependency, and output identities are immutable;
- CI passes and the repair PR is merged;
- exactly one replacement candidate is published;
- signature, provenance, SBOM, and attestations verify; and
- no temporary package credential remains.

Only then may the existing Milestone 13A disposable Maritime acceptance resume.
