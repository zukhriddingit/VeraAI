# Managed Browser-Extension Pairing Bootstrap

**Status:** Approved for implementation on 2026-07-28

## Goal

Allow a dedicated Vera OpenClaw Gateway on a managed container platform to receive one
founder-only Chrome extension pairing credential without relying on an interactive command,
shared sidecar volume, shell, CLI, or locally installed OpenClaw node.

The supervisor will accept an optional private server setting, validate it, and atomically
seed the exact OpenClaw browser-extension relay credential file before OpenClaw starts. The
seed is distinct from the Gateway bearer token and must not reach the child process, logs,
repository, image, evidence records, or public response data.

This repair preserves the existing Milestone 13A boundary:

- one dedicated Gateway and credential set per Vera user;
- runtime UID/GID `1000:1000`;
- public access only to exact `/browser/extension`;
- pairing authentication, Origin checks, and WebSocket subprotocol checks;
- one explicitly shared consent tab;
- minimized read-only snapshot only; and
- no navigation, typing, messaging, form submission, download, upload, application, payment,
  discovery engine, or Milestone 13B capability.

It does not alter `founder_core`, the existing RentCast live-search path, or any production
release-gate requirement.

## Root cause and evidence

The exact signed Gateway image reached Vera's route filter on Azure App Service while running
as UID/GID `1000:1000`. Managed HTTPS, exact-route isolation, and wrong-credential denial
worked. The remaining acceptance boundary was pairing bootstrap.

OpenClaw `2026.7.1` stores the Chrome extension relay credential in the host-local file:

```text
/data/.openclaw/credentials/browser-extension-relay.secret
```

The credential is a separate 64-character lowercase hexadecimal value. It is not the
`OPENCLAW_GATEWAY_TOKEN`. Reusing the Gateway token for extension pairing correctly failed
authentication.

An attempted shared-volume pairing seeder was not instantiated reliably by the disposable
App Service topology. The Azure resource group was deleted after the fail-closed result, and
the private evidence bundle records `failed_provider`. No prior evidence is changed.

## Selected design

### Private setting contract

The optional server-only setting is:

```text
OPENCLAW_EXTENSION_PAIRING_SEED
```

When present, its value must match:

```text
^[0-9a-f]{64}$
```

The value must be generated independently from every other credential. It may be supplied
only through the managed platform's private secret-setting mechanism. It must never use a
public or client-prefixed environment variable and must never be committed, printed, returned,
embedded in an image, placed in release evidence, or reused across Vera users.

The existing `OPENCLAW_GATEWAY_TOKEN` remains unchanged and distinct. The pairing seed is not
a fallback for that token, and the Gateway token is not a fallback for the pairing seed.

### Supervisor bootstrap sequence

The existing Node supervisor will perform this sequence before spawning the fixed route-filter
child:

1. Read `OPENCLAW_EXTENSION_PAIRING_SEED`, immediately remove the setting from the supervisor
   environment, and construct a separate child environment that also omits it. This happens
   before state validation or filesystem I/O so every later failure preserves the
   non-inheritance guarantee.
2. Require the fixed `OPENCLAW_STATE_DIR=/data/.openclaw` boundary and runtime identity
   `1000:1000`.
3. Prepare and validate the existing state tree with directories mode `0700`, files mode
   `0600`, and no symbolic links or unsupported entries.
4. If no seed was supplied, preserve the current behavior and do not create or modify the
   relay credential. This keeps providers with an existing interactive or persistent pairing
   mechanism compatible.
5. If a seed was supplied, validate its exact format before any child process is started.
6. Resolve only the fixed credential path beneath the fixed state boundary. No environment
   variable, argument, configuration field, or filesystem link may redirect it.
7. If the credential file does not exist, create it atomically with exclusive-create
   semantics and mode `0600`, write only the validated value, and verify the resulting entry
   is a regular non-symbolic-link file with the expected mode.
8. If the credential file already exists, require it to be a regular non-symbolic-link file
   containing a valid relay credential identical to the supplied value. An identical value is
   an idempotent success; any mismatch or malformed content fails closed.
9. Spawn the unchanged fixed route-filter command with the sanitized child environment.

The implementation must use Node standard-library primitives only. Secret equality must be
checked in constant time after fixed-length validation. The seed must not appear in thrown
errors, structured output, log messages, process arguments, or the child environment.

### Failure behavior

Malformed input, a symbolic link, a non-regular entry, an existing mismatch, an unexpected
path, a write race, a permission error, or a post-write verification failure prevents the
Gateway child from starting.

Errors may identify the failed security invariant in generic terms, but must not include the
credential value, a digest of it, or environment contents. The supervisor must remove the seed
from its environment even when validation or filesystem work fails.

### Atomicity and permissions

For a new credential, the supervisor must use exclusive creation rather than a
check-then-overwrite sequence. The process umask remains `0077`; the resulting file mode is
exactly `0600`. Existing matching credentials are never rewritten. The containing
`credentials` directory remains mode `0700`.

The immutable image contains no pairing credential. Restart persistence depends only on the
provider's private state volume. If a managed platform does not preserve that volume, the same
private seed may idempotently recreate the file at the next start; it still never reaches
OpenClaw's child environment.

## Alternatives rejected

### Reuse `OPENCLAW_GATEWAY_TOKEN`

OpenClaw treats extension relay pairing as a distinct credential boundary. Reuse failed live
authentication and would collapse two independent trust domains.

### Run an interactive `openclaw browser pair` command

Managed container startup has no reliable operator terminal and the hardened image contains no
shell or CLI launcher surface for an interactive bootstrap.

### Use a sidecar to write the credential

The disposable App Service attempt accepted the configuration but did not reliably instantiate
the non-public sidecar. It also introduces an unnecessary second process and shared-volume
coordination boundary.

### Add a public bootstrap endpoint

A network endpoint that creates or returns pairing credentials would broaden the public attack
surface, complicate authentication, and violate the exact-route Milestone 13A boundary.

### Bake the credential into the image

Image layers, registry metadata, SBOMs, caches, attestations, and downstream copies would make
the credential durable and shared. This is prohibited.

## Tests

Table-driven supervisor tests must prove:

- absent seed preserves current behavior and never adds the setting to the child environment;
- a valid fresh seed creates the fixed file with exact content and mode `0600`;
- a matching existing credential is accepted without rewriting it;
- an existing mismatch fails before spawn;
- malformed, uppercase, short, long, or whitespace-padded seeds fail before spawn;
- a symbolic link or non-regular credential entry fails before spawn;
- a creation race fails closed without overwriting either value;
- the seed is removed from both supervisor and child environments on success and failure;
- errors and captured logs never contain the seed or a derived credential hash;
- no input can override the fixed state or credential path; and
- the existing fixed command, signal forwarding, UID/GID checks, state permissions, and
  symlink defenses still pass.

Existing static configuration, image-layout, transport, route-isolation, WebSocket,
subprotocol, Origin, payload-limit, timeout, snapshot-minimization, and release-gate tests
remain mandatory.

## Validation and release gates

Before publication, the implementation must pass:

1. focused supervisor and configuration tests;
2. all affected repository unit and integration tests;
3. formatting, lint, typecheck, and production builds required by changed files;
4. local `linux/amd64` image build and immutable layout verification;
5. runtime identity verification for UID/GID `1000:1000`;
6. exact-route and correct/wrong pairing WebSocket tests;
7. Trivy with zero `HIGH` and zero `CRITICAL` findings;
8. immutable source, base-image, and dependency digest checks; and
9. CI, signing, provenance, SPDX SBOM, and attestations.

No image may be published and no Azure or Maritime resource may be created without fresh,
explicit remote authorization after all local gates pass. Publication is limited to exactly
one replacement candidate from the merged source commit.

If authorized, one new disposable managed-platform acceptance run will use a newly generated
private Gateway token and a distinct newly generated pairing seed. It must prove:

- managed HTTPS and WSS;
- exact `/browser/extension` exposure only;
- wrong pairing denial;
- correct pairing `101` with preserved subprotocol;
- Origin enforcement, ping/pong, bounded stability, payload limits, and timeouts;
- official Chrome extension pairing to one explicitly shared `https://example.com/` tab;
- one minimized read-only snapshot with no interaction;
- `no_shared_tab` after unsharing;
- shallow and deep OpenClaw security audits;
- credential revocation or deletion; and
- deletion of every disposable cloud resource.

Any failed security or transport gate requires immediate teardown and keeps
`founder_browser_experimental=no_go`. Real evidence remains outside Git under
`release-evidence/private/` with directories mode `0700` and files mode `0600`.

## Non-goals

This repair does not:

- deploy a permanent Gateway;
- change Vera search-profile behavior;
- add an AI chatbot or arbitrary search widening;
- add Zillow, Apartments.com, Facebook Marketplace, or broad browsing;
- permit browser navigation or interaction;
- expose OpenClaw Control UI or another Gateway route;
- change `founder_core` classification;
- weaken any evidence, security, or release gate; or
- begin Milestone 13B.
