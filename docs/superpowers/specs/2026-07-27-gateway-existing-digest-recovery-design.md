# Gateway Existing-Digest Attestation Recovery

**Status:** Approved for implementation on 2026-07-27

## Goal

Recover the one already-published Maritime bootstrap-compatible Gateway candidate without building
or publishing another image. The recovery must independently pull, inspect, zero-scan, sign, and
attest the exact immutable digest before any disposable Maritime acceptance begins.

The subject is fixed:

```text
source commit: 69fee2fcedf7d0474d5a75d64323318b993f7a6a
publication run: 30295038582
image:
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:5a7c1b5b92595185816203b39fc725fe6167f58eb0e3f52c9015ed6fbe1173a4
```

This repair does not change the Gateway image, OpenClaw, route filter, supervisor, Chrome
extension, source adapters, Maritime configuration, landing page, or Milestone 13B scope.

## Failure boundary

The manual publication used Buildx with `push: true`, which placed the candidate in GHCR but did
not load it into the job-local Docker image store. The next step called
`docker image inspect` through the shared layout verifier before pulling the immutable digest, so
the job failed even though an independent anonymous `linux/amd64` pull later proved the candidate
exists and the verifier accepts it.

The failed job skipped its Trivy/SBOM generation and all GitHub signing and attestation steps. The
OCI index contains BuildKit-generated SPDX and SLSA predicates, but the required GitHub Actions
attestations and Cosign signature do not exist. The candidate is therefore not deployable.

## Selected repair

Make two directly related workflow changes in one focused PR:

1. The publication workflow explicitly pulls the exact immutable digest before invoking the
   published-image layout verifier. This prevents future push-only Buildx outputs from reaching
   `docker image inspect` without a local image.
2. The existing attestation-resume workflow accepts either a successful build-and-scan job or the
   precise recoverable publication shape: build and push succeeded, the immutable digest was
   resolved, the first published-image layout step failed, later scan steps were skipped, and the
   partial publication artifact was preserved.

The recovery workflow does not trust that failed step as evidence. Before any registry write, it:

- downloads the publication artifact and binds it to the requested source, digest, and runtime
  lock;
- anonymously pulls the exact digest;
- verifies source, OpenClaw, and Chainguard labels;
- runs the shared image-layout and simulated-bootstrap verifier;
- generates a fresh SPDX SBOM with pinned Trivy `0.72.0`;
- generates a fresh HIGH/CRITICAL vulnerability record without suppressions;
- requires zero HIGH and zero CRITICAL findings; and
- only then authenticates to GHCR, emits exact-source GitHub provenance and SBOM attestations,
  signs the same digest with keyless Cosign, and independently verifies all three.

No Docker build, Buildx build, image push, mutable tag resolution, or Maritime command is allowed
in the recovery workflow.

## Rejected approaches

### Publish another candidate

Rerunning the publication workflow would create or risk creating a second replacement candidate,
contradicting the authorized exactly-one publication boundary.

### Sign locally

A local signature would not provide the reviewed GitHub Actions OIDC builder identity, retained
workflow evidence, or CI-gated provenance binding.

### Trust BuildKit predicates alone

The BuildKit predicates are useful supporting metadata but do not replace the required GitHub
attestation verification and Cosign signature gate.

## Failure-run eligibility

The recovery workflow obtains the original run and job metadata through the GitHub API. It accepts
exactly one `Build and scan Gateway candidate` job from the manual
`Release immutable Vera OpenClaw Gateway` workflow on the requested source.

A failed job is eligible only when:

- `Build and publish the commit-bound Gateway` succeeded;
- `Resolve immutable Gateway reference` succeeded;
- `Verify minimal published runtime identity` failed;
- `Generate SBOM and vulnerability evidence` was skipped;
- `Enforce zero unresolved critical or high findings` was skipped; and
- `Preserve pre-signing Gateway evidence` succeeded.

Every other failed-job shape is rejected. Even an eligible failure cannot reach registry writes
unless the fresh pull, layout, identity, SBOM, and zero-finding gates pass.

## Tests and static enforcement

The workflow verifier and table-driven unit tests must prove:

- release verification is preceded by an exact-digest pull;
- recovery accepts a successful scan job or only the reviewed failed-step shape;
- recovery regenerates SBOM and vulnerability evidence;
- recovery enforces zero HIGH/CRITICAL findings before GHCR login;
- Trivy is pinned and no ignore or database-suppression option exists;
- the source commit, publication run, image digest, runtime lock, base digest, and OpenClaw digest
  are bound;
- all actions are commit-pinned;
- automatic triggers, builds, publications, mutable images, deployments, and release side effects
  are absent; and
- signing and attestations remain after all read-only verification gates.

## PR, recovery, and acceptance

The repair uses one CI-gated PR. After it merges, create the temporary package-write Actions secret
without printing it, dispatch the attestation-resume workflow exactly once for the fixed subject,
wait for completion, download its evidence, and independently verify the signature and both
attestations. Delete the temporary secret immediately after the run reaches a terminal state.

Only a fully passing recovery authorizes the already-approved one disposable Maritime acceptance.
If recovery fails, do not create or deploy a Maritime agent. Return:

```text
founder_browser_experimental=no_go
```

with the next smallest repair and no second recovery dispatch.

## Evidence and cleanup

New real evidence remains outside Git under a distinct directory in
`release-evidence/private/`, with directories mode `0700` and files mode `0600`. Records bind the
recovery workflow commit, image source commit, publication run, immutable digest, validation
results, and artifact hashes. Previous evidence remains unchanged.

Whether recovery or live acceptance passes or fails, remove temporary credentials and files,
delete any disposable Maritime agent, preserve only sanitized private evidence, and leave the
isolated worktree clean.
