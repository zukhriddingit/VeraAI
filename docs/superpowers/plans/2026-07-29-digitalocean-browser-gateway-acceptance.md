# DigitalOcean Browser Gateway Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducibly deploy and fully accept one disposable hardened OpenClaw Gateway on
DigitalOcean behind a managed TLS Load Balancer, then revoke browser access and either retain it
only by explicit founder choice or destroy every disposable resource.

**Architecture:** Repository-owned TypeScript tools create and clean up a tag-scoped diagnostics
stack through the DigitalOcean API, while a placeholder-based cloud-init template installs Docker
and runs exactly one immutable Gateway container on the Droplet's VPC address. Public DNS, TLS, and
Load Balancer ingress are created only after backend-local security, route, WebSocket, and audit
gates pass.

**Tech Stack:** TypeScript 6, Node.js 24 native `fetch`/crypto/filesystem APIs, Vitest 4, Bash,
cloud-init, systemd, Docker, DigitalOcean v2 API, official OpenClaw Chrome extension.

## Global Constraints

- Use only DigitalOcean for this acceptance.
- Keep the Gateway image pinned to
  `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd`.
- Preserve runtime UID/GID `1000:1000`.
- Never expose Droplet ports 80, 443, or 18789 directly to the internet.
- Permit temporary SSH only from the operator's exact public IPv4 `/32`, with key-only
  authentication.
- Use no Nginx, Caddy, Traefik, Lego, Certbot, mutable image tag, or self-signed final certificate.
- Never print or commit an API token, SSH private key, Gateway token, relay pairing secret,
  endpoint address, live hostname, or raw browser data.
- Create no Load Balancer, DNS record, certificate, or public WSS route before backend-local
  acceptance passes.
- Access no rental site or browser tab before explicit sharing.
- Perform one minimized read-only snapshot against one shared `https://example.com/` tab.
- Leave `founder_core` gates unchanged and do not begin Milestone 13B before `passed_13a`.

## File Structure

- `infra/digitalocean/browser-gateway/cloud-init.template.yaml`: secret-free guest bootstrap and
  systemd service definition.
- `infra/digitalocean/browser-gateway/infrastructure-intent.json`: checked-in provider/network
  contract.
- `infra/digitalocean/browser-gateway/config.ts`: immutable constants, validators, and private-file
  guards shared by lifecycle tools.
- `infra/digitalocean/browser-gateway/digitalocean-api.ts`: narrow API client, response validators,
  and bounded polling.
- `infra/digitalocean/browser-gateway/render-cloud-init.ts`: mode-`0600` secret-file renderer.
- `infra/digitalocean/browser-gateway/create-diagnostics-stack.ts`: create tag, firewall, SSH key,
  and Droplet, with rollback on partial failure.
- `infra/digitalocean/browser-gateway/cleanup-stack.ts`: idempotent dependency-ordered teardown.
- `infra/digitalocean/browser-gateway/validate.sh`: YAML, cloud-config, Bash, systemd, digest,
  placeholder, ingress, timeout, and cleanup checks.
- `infra/digitalocean/browser-gateway/README.md`: secret-safe operator and acceptance runbook.
- `scripts/verify-digitalocean-browser-gateway.ts`: static repository policy verifier.
- `scripts/verify-digitalocean-browser-gateway.unit.test.ts`: verifier and mutation regressions.
- `infra/digitalocean/browser-gateway/config.unit.test.ts`: private-file and argument validation.
- `infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts`: API, polling, rollback, and
  redaction tests.
- `package.json`: focused verification commands.
- `.github/workflows/ci.yml`: required CI step.

---

### Task 1: Static DigitalOcean deployment contract

**Files:**

- Create: `scripts/verify-digitalocean-browser-gateway.ts`
- Create: `scripts/verify-digitalocean-browser-gateway.unit.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: repository file contents supplied as strings.
- Produces:
  `findDigitalOceanBrowserGatewayViolations(input: DigitalOceanBrowserGatewayFixture): string[]`.

- [ ] **Step 1: Write the failing verifier tests**

```ts
it("accepts the reviewed deployment assets", () => {
  expect(findDigitalOceanBrowserGatewayViolations(repositoryFixture())).toEqual([]);
});

it.each([
  ["0.0.0.0/0", "Public SSH must be impossible."],
  ["vera-openclaw-gateway:latest", "Gateway image must be immutable."],
  ["nginx", "Custom TLS edge software is forbidden."]
])("rejects %s", (unsafe, expected) => {
  const input = repositoryFixture();
  input.cloudInit += `\n${unsafe}\n`;
  expect(findDigitalOceanBrowserGatewayViolations(input)).toContain(expected);
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-digitalocean-browser-gateway.unit.test.ts
```

Expected: failure because `verify-digitalocean-browser-gateway.ts` does not exist.

- [ ] **Step 3: Implement the closed static verifier**

```ts
export interface DigitalOceanBrowserGatewayFixture {
  cloudInit: string;
  intent: unknown;
  readme: string;
  renderer: string;
  creator: string;
  cleanup: string;
}

export function findDigitalOceanBrowserGatewayViolations(
  input: DigitalOceanBrowserGatewayFixture
): string[] {
  const violations: string[] = [];
  // Require the exact digest, exact placeholders, VPC-only publish, zero application ingress,
  // bounded timeouts, fail-closed cleanup, and the reviewed documentation gates.
  return violations;
}
```

The executable entry point reads only the exact checked-in files and exits nonzero for any
violation.

- [ ] **Step 4: Add the package script and run the expected failing file-existence gate**

Add:

```json
"verify:digitalocean-browser-gateway": "tsx scripts/verify-digitalocean-browser-gateway.ts"
```

Run:

```bash
pnpm verify:digitalocean-browser-gateway
```

Expected: failure until the deployment assets from Tasks 2–4 exist.

- [ ] **Step 5: Commit the test-first verifier boundary**

```bash
git add package.json scripts/verify-digitalocean-browser-gateway.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
git commit -m "test: define DigitalOcean gateway deployment boundary"
```

### Task 2: Corrected idempotent cloud-init and provider intent

**Files:**

- Create: `infra/digitalocean/browser-gateway/cloud-init.template.yaml`
- Create: `infra/digitalocean/browser-gateway/infrastructure-intent.json`

**Interfaces:**

- Consumes: exact `__VERA_GATEWAY_TOKEN__` and `__VERA_EXTENSION_PAIRING_SEED__` substitutions.
- Produces: `/var/lib/vera-browser-gateway/provisioning-result.json` with status
  `backend_ready` or `failed`, never a credential.

- [ ] **Step 1: Extend the static tests with the exact guest invariants**

Require tests for:

```ts
expect(cloudInit).toContain("vera-browser-gateway-bootstrap.service");
expect(cloudInit).toContain(
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd"
);
expect(cloudInit).toContain("--user 1000:1000");
expect(cloudInit).toContain('-p "${vpc_ipv4}:18789:18789"');
expect(cloudInit).toContain(
  "/var/lib/vera-browser-gateway/state:/data"
);
expect(cloudInit).not.toMatch(/\b(?:nginx|caddy|traefik|lego|certbot)\b/iu);
```

- [ ] **Step 2: Create the machine-readable intent**

The JSON must declare one `ubuntu-24-04-x64` Droplet in `nyc1`, size `s-1vcpu-2gb`, one tag-scoped
firewall, temporary SSH `/32` only, no inbound application rules, VPC-only 18789 binding, and all
public resources deferred until backend readiness.

- [ ] **Step 3: Create the cloud-init template**

Write exactly three `write_files` entries:

1. `/usr/local/sbin/vera-browser-gateway-bootstrap` mode `0700`;
2. `/etc/systemd/system/vera-browser-gateway-bootstrap.service` mode `0644`;
3. `/etc/vera-browser-gateway/gateway-token` and
   `/etc/vera-browser-gateway/extension-pairing-seed` as separate mode-`0600` entries.

The bootstrap must use:

```bash
docker run -d \
  --name vera-browser-gateway \
  --restart unless-stopped \
  --user 1000:1000 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount type=bind,src=/var/lib/vera-browser-gateway/state,dst=/data \
  -p "${vpc_ipv4}:18789:18789" \
  "${gateway_image}"
```

It removes only the fixed container/network during idempotent recreation, preserves the persistent
state, and writes a closed sanitized result on success or error.

- [ ] **Step 4: Run the static verifier test**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-digitalocean-browser-gateway.unit.test.ts
```

Expected: remaining failures name only the not-yet-created renderer/lifecycle assets.

- [ ] **Step 5: Commit the guest bootstrap**

```bash
git add infra/digitalocean/browser-gateway/cloud-init.template.yaml \
  infra/digitalocean/browser-gateway/infrastructure-intent.json \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
git commit -m "feat: add private DigitalOcean gateway bootstrap"
```

### Task 3: Secret-safe renderer and configuration guards

**Files:**

- Create: `infra/digitalocean/browser-gateway/config.ts`
- Create: `infra/digitalocean/browser-gateway/config.unit.test.ts`
- Create: `infra/digitalocean/browser-gateway/render-cloud-init.ts`

**Interfaces:**

- Produces:
  `readMode0600Secret(path: string, label: string): string`,
  `parseOperatorIpv4(value: string): string`, and
  `renderCloudInit(input: RenderCloudInitInput): Promise<void>`.

- [ ] **Step 1: Write failing private-file tests**

```ts
it("accepts two distinct lowercase-hex mode-0600 files", async () => {
  await expect(readCredentialPair(fixturePaths)).resolves.toEqual({
    gatewayToken: "a".repeat(64),
    pairingSeed: "b".repeat(64)
  });
});

it.each(["0644", "0777", "symlink", "uppercase", "same-value"])(
  "rejects unsafe credential input %s",
  async (mutation) => {
    await expect(readCredentialPair(mutatedFixture(mutation))).rejects.toThrow(
      /credential input rejected/u
    );
  }
);
```

- [ ] **Step 2: Implement exact file and argument guards**

Use `lstat`, require a regular non-symlink file owned by the current operator with mode `0600`,
require `/^[0-9a-f]{64}$/u`, and compare distinct credentials using `timingSafeEqual`.

- [ ] **Step 3: Implement the renderer**

Replace each exact placeholder once, reject any remaining `__VERA_` marker, create the output with
exclusive mode `0600`, and print only:

```text
rendered_cloud_init=ready
```

- [ ] **Step 4: Run renderer tests and the static verifier**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/config.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
pnpm verify:digitalocean-browser-gateway
```

Expected: renderer tests pass; the verifier names only lifecycle/runbook assets still absent.

- [ ] **Step 5: Commit**

```bash
git add infra/digitalocean/browser-gateway/config.ts \
  infra/digitalocean/browser-gateway/config.unit.test.ts \
  infra/digitalocean/browser-gateway/render-cloud-init.ts
git commit -m "feat: render private Gateway cloud-init safely"
```

### Task 4: DigitalOcean create and cleanup lifecycle

**Files:**

- Create: `infra/digitalocean/browser-gateway/digitalocean-api.ts`
- Create: `infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts`
- Create: `infra/digitalocean/browser-gateway/create-diagnostics-stack.ts`
- Create: `infra/digitalocean/browser-gateway/cleanup-stack.ts`

**Interfaces:**

- Produces:
  `DigitalOceanClient`,
  `createDiagnosticsStack(input: CreateStackInput): Promise<PrivateStackManifest>`, and
  `cleanupStack(input: CleanupStackInput): Promise<CleanupSummary>`.

- [ ] **Step 1: Write failing API and rollback tests**

```ts
it("creates firewall-before-Droplet and records only sanitized state", async () => {
  const result = await createDiagnosticsStack(fixtureInput);
  expect(requestKinds).toEqual(["tag", "firewall", "ssh_key", "droplet"]);
  expect(result).not.toHaveProperty("apiToken");
  expect(JSON.stringify(result)).not.toContain(fixtureInput.apiToken);
});

it("rolls back a partial create in reverse dependency order", async () => {
  failRequest("droplet");
  await expect(createDiagnosticsStack(fixtureInput)).rejects.toThrow(/droplet_create_failed/u);
  expect(deleteKinds).toEqual(["ssh_key", "firewall", "tag"]);
});

it("treats provider 404 as idempotent cleanup success", async () => {
  respondToDeletesWith(404);
  await expect(cleanupStack(fixtureCleanupInput)).resolves.toMatchObject({
    cleanupComplete: true
  });
});
```

- [ ] **Step 2: Implement the narrow API client**

`DigitalOceanClient` accepts the token only in memory, sends it only as the bearer header, applies a
15-second request timeout, validates required response fields, maps provider errors to bounded
codes, and never includes response bodies or headers in thrown errors.

- [ ] **Step 3: Implement the create transaction**

Validate the rendered cloud-config and key paths as mode `0600`, require
`--confirm create-one-disposable-gateway`, create the tag, firewall, SSH key, and Droplet, and poll
the Droplet for at most ten minutes. On any error, call cleanup for the resources already recorded.
Write the private manifest through exclusive mode `0600`.

- [ ] **Step 4: Implement idempotent cleanup**

Delete in this order when present:

```text
Load Balancer -> DNS record -> certificate -> Droplet -> firewall -> SSH key -> tag
```

Poll deletion with bounded timeouts, accept 404, and emit only resource-kind/absent booleans.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/config.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add infra/digitalocean/browser-gateway/digitalocean-api.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  infra/digitalocean/browser-gateway/create-diagnostics-stack.ts \
  infra/digitalocean/browser-gateway/cleanup-stack.ts
git commit -m "feat: add bounded DigitalOcean Gateway lifecycle"
```

### Task 5: Shell validation, runbook, and CI gate

**Files:**

- Create: `infra/digitalocean/browser-gateway/validate.sh`
- Create: `infra/digitalocean/browser-gateway/README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/FOUNDER_STAGING_EVIDENCE.md`

**Interfaces:**

- Consumes: the checked-in template, intent, and lifecycle sources.
- Produces: one secret-free validation summary and a required CI failure on any policy regression.

- [ ] **Step 1: Create the shell validator**

Extract the embedded bootstrap with Ruby YAML, run `bash -n`, run `systemd-analyze verify` on the
extracted unit when available, run `cloud-init schema` when available, and enforce exact strings
with `rg`. A pinned Ubuntu container performs cloud-init schema validation in CI.

- [ ] **Step 2: Document the exact operator checkpoints**

The runbook must specify:

- temporary scoped-token creation without chat exposure;
- Keychain and mode-`0600` handling;
- exact `/32` SSH rule;
- cloud-init and local acceptance commands;
- immediate SSH-rule/key removal;
- DigitalOcean DNS and managed-certificate prerequisites;
- HTTPS 443 to private HTTP 18789 Load Balancer configuration;
- public WSS and Chrome checkpoints;
- evidence hashes and failure teardown; and
- explicit success retention choice.

- [ ] **Step 3: Add the CI step**

Add after existing Gateway runtime checks:

```yaml
- name: Verify DigitalOcean browser Gateway deployment
  run: |
    pnpm verify:digitalocean-browser-gateway
    VERA_DO_VALIDATE_WITH_DOCKER=1 \
      bash infra/digitalocean/browser-gateway/validate.sh
```

- [ ] **Step 4: Update evidence documentation**

Add the DigitalOcean topology, backend-before-ingress gate, temporary SSH removal, managed TLS,
one-tab snapshot, revocation, and zero-billable-resource requirements without weakening
`founder_core`.

- [ ] **Step 5: Run focused and repository checks**

Run:

```bash
bash infra/digitalocean/browser-gateway/validate.sh
pnpm verify:digitalocean-browser-gateway
pnpm verify:browser-boundaries
pnpm verify:remote-extension-config
pnpm verify:release-documentation
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/config.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
pnpm lint
pnpm typecheck
pnpm format:check
git diff --check
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml docs/FOUNDER_STAGING_EVIDENCE.md \
  infra/digitalocean/browser-gateway/README.md \
  infra/digitalocean/browser-gateway/validate.sh
git commit -m "ci: gate DigitalOcean Gateway deployment assets"
```

### Task 6: Focused PR and merge

**Files:**

- Review all files changed since `origin/main`.

**Interfaces:**

- Produces: one merged, green, focused infrastructure PR.

- [ ] **Step 1: Review scope and secrets**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git log --oneline origin/main..HEAD
rg -n '(do[ptr]_v1_|BEGIN OPENSSH PRIVATE KEY|Authorization: Bearer|[0-9a-f]{64})' \
  infra/digitalocean/browser-gateway scripts/verify-digitalocean-browser-gateway*
```

The only allowed 64-hex value is the reviewed image digest and documented source/hash constants.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin codex/digitalocean-browser-gateway-acceptance
gh pr create --base main --head codex/digitalocean-browser-gateway-acceptance \
  --title "Add reproducible DigitalOcean browser Gateway acceptance" \
  --body-file release-evidence/private/m13a-digitalocean-browser-gateway-pr-body.md
```

- [ ] **Step 3: Wait for every required check**

Run:

```bash
gh pr checks --watch
```

Expected: every required check succeeds.

- [ ] **Step 4: Merge and bind the live run to merged source**

Run:

```bash
gh pr merge --squash --delete-branch
git fetch origin main
git rev-parse origin/main
```

Record the exact merged source SHA privately before creating infrastructure.

### Task 7: Diagnostics-first Droplet and backend-local acceptance

**Files:**

- Private only: `release-evidence/private/m13a-digitalocean-droplet-<run>/`.

**Interfaces:**

- Consumes: temporary scoped DigitalOcean token, two distinct generated credentials, temporary SSH
  key, exact operator IPv4 `/32`, merged template.
- Produces: one private backend-ready manifest and sanitized acceptance evidence.

- [ ] **Step 1: Create private runtime material**

Generate two distinct 32-byte hex credentials and one Ed25519 key, store them only in mode-`0600`
files/Keychain, render cloud-init, and verify no value reaches terminal output.

- [ ] **Step 2: Create the stack**

Run the merged create tool with `--confirm create-one-disposable-gateway`. Verify the firewall is
tag-attached before Droplet creation, the only inbound rule is SSH from the exact `/32`, and no
Load Balancer/DNS/certificate exists.

- [ ] **Step 3: Monitor bootstrap through key-only SSH**

Poll `cloud-init status --wait` with a ten-minute bound. Collect only sanitized cloud-init,
systemd, Docker, container-state, permission, listener, and bounded-log evidence.

- [ ] **Step 4: Run every backend-local gate**

Verify exact digest, UID/GID, executable surface, no shell/package manager, state ownership,
listeners, 404/426, wrong-secret 401, correct WebSocket 101 with
`openclaw-extension-relay`, ping/pong, bounded stability, oversized-payload failure, shallow/deep
audits, and secret-free logs.

- [ ] **Step 5: Stop on any failure**

Record one failing layer and smallest repair, run cleanup, revoke/delete the API token, remove local
files/Keychain entries, verify zero billable resources, and return
`founder_browser_experimental=no_go`.

### Task 8: Remove SSH, add managed ingress, Chrome acceptance, and final evidence

**Files:**

- Private only: the new acceptance evidence bundle.

**Interfaces:**

- Produces: `passed_13a` only after public WSS, one-tab snapshot, revocation, evidence validation,
  and an explicit retention/cleanup decision.

- [ ] **Step 1: Remove operator ingress**

Delete the SSH firewall rule, remove the temporary key from `authorized_keys`, and prove ports 22,
80, 443, and 18789 are externally unreachable on the Droplet.

- [ ] **Step 2: Create managed DNS/TLS and Load Balancer**

Use `browser-staging.verahousing.app` only if the founder-controlled zone is available through
DigitalOcean DNS. Create one managed certificate and one Regional Load Balancer with only HTTPS 443
to private HTTP 18789. Allow 18789 in the Droplet firewall only from that Load Balancer.

- [ ] **Step 3: Run every public HTTPS/WSS gate**

Verify certificate trust, hostname, route isolation, Control UI absence, 401/101 pairing behavior,
Origin enforcement, subprotocol preservation, ping/pong, stability, payload limits, and secret-free
logs. Stop and tear down before Chrome if any item fails.

- [ ] **Step 4: Pause for manual Chrome pairing**

Place the official pairing string on the clipboard without printing it. Ask the founder to load the
reviewed extension, pair it, open `https://example.com/`, share exactly one tab, and reply:

```text
Paired and one example.com tab shared.
```

- [ ] **Step 5: Execute the one read-only snapshot and revocation checks**

After confirmation, execute one minimized snapshot, retain no raw page or screenshot, ask the
founder to unshare, prove the next snapshot fails with `no_shared_tab`, and revoke pairing.

- [ ] **Step 6: Seal evidence and pause for the success disposition**

Bind the bundle to the exact Gateway digest/source revision, merged template hash, opaque Droplet
and Load Balancer identifiers, hostname hash, OpenClaw/extension versions, UTC time, and
`founder_browser_experimental`. Validate and hash the bundle.

On success, keep all tabs unshared and browser access revoked while asking:

```text
A. Retain the working Gateway temporarily for founder recording.
B. Destroy every disposable resource immediately.
```

Only after the founder chooses may the run finish with the remaining-resource/cost state,
`passed_13a`, and `Milestone 13B is authorized`.
