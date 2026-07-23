# Maritime and OpenClaw Founder Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and validate an immutable, least-privilege founder staging release on Maritime with a pinned OpenClaw gateway, private Vera worker, explicit local browser node, and one unified positive/failure-path evidence report.

**Architecture:** Maritime hosts one private serverless Vera worker and one public TLS-terminated OpenClaw gateway; PostgreSQL remains canonical and the founder's browser profile remains local. The gateway receives a schema-validated checked-in configuration through Maritime's supported custom-files API, exposes only authenticated gateway/node transport, pins one node and profile, and denies agent, messaging, filesystem, shell, plugin, cron, model, and arbitrary tool surfaces.

**Tech Stack:** `maritime-cli@1.7.0`, `maritime-sdk@0.5.0`, OpenClaw `2026.6.33`, Node `24.13.0`, pnpm `11.14.0`, Docker BuildKit/buildx, OCI digests/attestations, Vitest 4, Playwright 1.61, PostgreSQL 18.4.

## Global Constraints

- Maritime is Vera's primary hosted execution and scheduling plane; PostgreSQL is canonical for policy, jobs, attempts, leases, approvals, results, and audit.
- One region, one web instance, one private Maritime worker, one managed PostgreSQL database, one founder-only Maritime OpenClaw gateway, and one explicitly paired local node/profile; no horizontal scaling.
- `maritime-cli` is pinned to `1.7.0`; application runtime code uses `maritime-sdk` pinned to `0.5.0` and never spawns an interactive CLI from an HTTP request.
- OpenClaw gateway and node are exactly `2026.6.33`; the official multi-architecture gateway image index is `ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee`.
- Worker base image is `node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f`.
- Never deploy `latest`, a mutable-only tag, Maritime's historical OpenClaw `2026.5.28`, or an image without recorded digest, SBOM, provenance, and vulnerability-review evidence.
- The Vera worker has no public ingress. Maritime wake/status APIs and PostgreSQL queue claims are its control plane.
- The OpenClaw gateway is public only because the founder's local node must connect over TLS/WSS; token authentication, failed-auth rate limits, explicit device pairing, and device identity remain mandatory.
- The gateway token is a full-operator secret. Keep it server/local-node only, rotate it independently, and never place it in a URL, client bundle, log, database, release manifest, or command argument.
- Gateway configuration disables Control UI, chat/responses APIs, cron, channels, plugins, commands, MCP, ACP, agent tools, shell, filesystem, elevated mode, model/provider credentials, and automatic updates.
- `gateway.nodes.browser.mode` is `manual`; `gateway.nodes.browser.node` and local `nodeHost.browserProxy.allowProfiles` bind the exact founder node/profile.
- Only `browser.proxy` may be relayed to the paired node; system, shell, filesystem, camera, microphone, screen recording, contacts, SMS, calendar, notification, download, upload, message, apply, and payment commands are denied.
- Browser jobs remain user-triggered, exact-URL allowlisted, founder-only, kill-switch controlled, read/capture only, and disabled by default for a public release.
- Browser cookies, passwords, storage, profiles, CDP URLs, full snapshots, screenshots, and raw private pages never enter PostgreSQL, Maritime jobs, logs, analytics, or Git.
- Do not request a Maritime token until local code, config validation, mock tests, database tests, and build pass. When requested, the user authenticates locally with `maritime login` or a scoped `MARITIME_TOKEN`; no token is pasted into chat.
- Do not perform the operator-controlled deploy until the user approves that exact live action.

---

## File Map

- Modify `apps/worker/package.json` and `pnpm-lock.yaml`: make OpenClaw `2026.6.33` a lockfile-pinned worker runtime dependency.
- Modify `Dockerfile`: digest-pin Node, remove global npm installation, copy locked OpenClaw CLI, retain non-root runtime.
- Modify `.github/workflows/ci.yml`: immutable GitHub Action commit SHAs and release validation.
- Create `infra/maritime/openclaw/openclaw.json5`: exact least-privilege gateway configuration.
- Create `infra/maritime/openclaw/node.openclaw.json5`: founder local node profile allowlist example with no secret.
- Create `scripts/verify-openclaw-config.ts`: invoke the pinned OpenClaw schema validator and enforce Vera-specific negative assertions.
- Create `scripts/verify-openclaw-config.unit.test.ts`: config mutation fixtures.
- Create `scripts/maritime-upload-openclaw-config.ts`: supported deploy-scoped custom-files API upload with masked diagnostics.
- Create `scripts/maritime-upload-openclaw-config.unit.test.ts`: URL, auth, payload, error, and log-safety tests.
- Create `infra/maritime/release-manifest.schema.json`: immutable release evidence schema.
- Create `scripts/verify-release-manifest.ts`: digest/SBOM/provenance/signature/advisory evidence validation.
- Create `scripts/verify-release-manifest.unit.test.ts`: mutable-image and missing-evidence failures.
- Modify `infra/maritime/validate.mjs`: run config/manifest checks and reject public worker/unsafe gateway claims.
- Modify `infra/maritime/README.md`: private worker, exact gateway deployment, supported custom-file upload, trigger, rollback, and token boundary.
- Modify `infra/maritime/OPENCLAW.md`: public endpoints, pairing, node config, audit commands, rotation, rollback, and privacy transit.
- Modify `infra/maritime/ENVIRONMENT.md`: remove gateway model credentials and add exact founder/browser/release variables.
- Modify `infra/maritime/COSTS.md`: five-minute trigger with 120-second worker idle timeout.
- Create `apps/web/lib/server/runtime-security-config.ts` and tests: fail-closed hosted browser/Maritime configuration validation.
- Create `apps/worker/src/runtime-security-config.ts` and tests: fail-closed worker integration/browser/notification/secret validation.
- Modify `apps/web/lib/server/application.ts` and `apps/worker/src/postgres-runtime.ts`: consume validated configuration instead of ad hoc production defaults.
- Create `scripts/staging/founder-release-smoke.ts`: unified opt-in staging matrix and sanitized JSON/Markdown evidence.
- Create `scripts/staging/founder-release-smoke.unit.test.ts`: env validation, redaction, phase ordering, and failure aggregation.
- Create `scripts/staging/gateway-http-smoke.ts`: unauthenticated/malformed/disabled endpoint checks.
- Create `scripts/staging/gateway-http-smoke.unit.test.ts`: offline HTTP fixtures.
- Modify `packages/connectors/src/maritime.staging.test.ts`, `packages/connectors/src/openclaw-current-tab.live.test.ts`, and `packages/notifications/src/web-push.staging.test.ts`: callable phase functions with unchanged default skip behavior.
- Create `docs/RELEASE_READINESS.md`: final topology, evidence table, blocker classes, versions, rollback, and explicit release outcome.
- Modify `docs/SECURITY_REVIEW.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS/0007-maritime-openclaw-contract-boundaries.md`: final enforcement/evidence references.

### Task 1: Pin the Worker Supply Chain and CI Actions

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `Dockerfile`
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/verify-worker-image-boundaries.ts`
- Create: `scripts/verify-worker-image-boundaries.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: exact Node/OpenClaw versions and pnpm lockfile.
- Produces: a non-root worker image whose base and CLI bytes are reproducible and statically verified.

- [ ] **Step 1: Write failing image-boundary tests**

```ts
it("requires immutable base and lockfile-pinned OpenClaw", () => {
  const violations = findWorkerImageViolations({ dockerfile, workerPackage, lockfile });
  expect(violations).toEqual([]);
});

it("rejects a tag-only base or global npm install", () => {
  expect(findWorkerImageViolations({
    dockerfile: "FROM node:24.13.0-bookworm-slim\nRUN npm install -g openclaw@2026.6.33",
    workerPackage: { dependencies: {} },
    lockfile: ""
  })).toEqual(expect.arrayContaining([
    expect.stringContaining("immutable Node digest"),
    expect.stringContaining("global OpenClaw installation"),
    expect.stringContaining("worker dependency")
  ]));
});
```

- [ ] **Step 2: Run and confirm the current Dockerfile fails**

Run: `pnpm exec vitest run --project unit scripts/verify-worker-image-boundaries.unit.test.ts`

Expected: FAIL because the verifier does not exist and the Dockerfile uses tag-only `FROM` plus runtime `npm install --global`.

- [ ] **Step 3: Add OpenClaw through the workspace lockfile**

Add to `apps/worker/package.json`:

```json
"openclaw": "2026.6.33"
```

Run: `pnpm install --lockfile-only`

Expected: `pnpm-lock.yaml` contains an exact `openclaw@2026.6.33` resolution and integrity metadata.

- [ ] **Step 4: Rewrite the image boundary with immutable base identity**

Use this exact base in both stages:

```dockerfile
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS build
```

and:

```dockerfile
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS runtime
```

Remove `npm install --global openclaw...`. Keep the existing frozen pnpm install and node_modules copies, set:

```dockerfile
ENV VERA_OPENCLAW_EXECUTABLE=/workspace/apps/worker/node_modules/.bin/openclaw
```

Create user/group without network access, keep `USER vera`, and retain the existing healthcheck.

- [ ] **Step 5: Implement and run the worker image verifier**

The verifier must reject tag-only `FROM`, `npm install --global`, mutable `latest`, missing non-root user, missing healthcheck, missing exact worker dependency, and absence of the exact lockfile resolution.

Add:

```json
"verify:worker-image-boundaries": "tsx scripts/verify-worker-image-boundaries.ts"
```

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-worker-image-boundaries.unit.test.ts
pnpm verify:worker-image-boundaries
docker build --tag vera-worker:local-security-review .
docker run --rm --entrypoint /workspace/apps/worker/node_modules/.bin/openclaw vera-worker:local-security-review --version
```

Expected: PASS and exact output containing `2026.6.33`.

- [ ] **Step 6: Pin every GitHub Action to its reviewed commit**

Replace action tags with these exact immutable commits and keep the human-readable tag in comments:

```yaml
- uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
- uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
- uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
```

Add `pnpm verify:worker-image-boundaries` before build.

- [ ] **Step 7: Commit supply-chain pins**

```bash
git add apps/worker/package.json pnpm-lock.yaml Dockerfile .github/workflows/ci.yml scripts/verify-worker-image-boundaries.ts scripts/verify-worker-image-boundaries.unit.test.ts package.json
git commit -m "build: pin worker runtime supply chain"
```

### Task 2: Enforce the Least-Privilege OpenClaw Configuration

**Files:**
- Create: `infra/maritime/openclaw/openclaw.json5`
- Create: `infra/maritime/openclaw/node.openclaw.json5`
- Create: `scripts/verify-openclaw-config.ts`
- Create: `scripts/verify-openclaw-config.unit.test.ts`
- Modify: `package.json`
- Modify: `infra/maritime/OPENCLAW.md`

**Interfaces:**
- Consumes: OpenClaw `2026.6.33` config schema and environment-only `OPENCLAW_GATEWAY_TOKEN`/`VERA_OPENCLAW_NODE_ID`.
- Produces: a gateway config with authenticated node transport and no autonomous agent/tool/message surface, plus a local node config exposing only profile `vera-zillow`.

- [ ] **Step 1: Write verifier mutation tests**

```ts
it.each([
  ["control UI", (config: VeraOpenClawConfig) => { config.gateway.controlUi.enabled = true; }],
  ["automatic node routing", (config: VeraOpenClawConfig) => { config.gateway.nodes.browser.mode = "auto"; }],
  ["system command", (config: VeraOpenClawConfig) => { config.gateway.nodes.allowCommands.push("system.run"); }],
  ["plugin loading", (config: VeraOpenClawConfig) => { config.plugins.enabled = true; }],
  ["cron", (config: VeraOpenClawConfig) => { config.cron.enabled = true; }],
  ["message tooling", (config: VeraOpenClawConfig) => { config.tools.allow.push("message"); }]
])("rejects %s", (_name, mutate) => {
  const config = structuredClone(validConfig);
  mutate(config);
  expect(findVeraOpenClawConfigViolations(config)).not.toEqual([]);
});
```

- [ ] **Step 2: Run and confirm the config is absent**

Run: `pnpm exec vitest run --project unit scripts/verify-openclaw-config.unit.test.ts`

Expected: FAIL because the configuration and verifier do not exist.

- [ ] **Step 3: Create the exact hosted gateway config**

```json5
{
  meta: { lastTouchedVersion: "2026.6.33" },
  env: { shellEnv: { enabled: false } },
  update: { channel: "stable", checkOnStart: false, auto: { enabled: false } },
  logging: { level: "info", consoleLevel: "info", redactSensitive: "tools" },
  acp: { enabled: false },
  cron: { enabled: false },
  plugins: { enabled: false, allow: [], deny: [] },
  commands: {
    native: false,
    nativeSkills: false,
    text: false,
    bash: false,
    config: false,
    mcp: false,
    plugins: false,
    debug: false,
    restart: false,
    useAccessGroups: true,
    ownerAllowFrom: []
  },
  tools: {
    profile: "minimal",
    allow: [],
    alsoAllow: [],
    deny: [
      "browser", "canvas", "terminal", "exec", "process", "read", "write", "edit",
      "apply_patch", "message", "nodes", "gateway", "cron", "sessions_spawn",
      "sessions_send", "web_search", "web_fetch"
    ],
    agentToAgent: { enabled: false, allow: [] },
    sessions: { visibility: "self" },
    elevated: { enabled: false },
    web: { search: { enabled: false }, fetch: { enabled: false } },
    experimental: { planTool: false }
  },
  channels: {},
  gateway: {
    port: 18789,
    mode: "local",
    bind: "lan",
    controlUi: {
      enabled: false,
      allowedOrigins: [],
      embedSandbox: "strict",
      allowExternalEmbedUrls: false,
      dangerouslyAllowHostHeaderOriginFallback: false,
      allowInsecureAuth: false,
      dangerouslyDisableDeviceAuth: false
    },
    auth: {
      mode: "token",
      token: "${OPENCLAW_GATEWAY_TOKEN}",
      allowTailscale: false,
      rateLimit: { maxAttempts: 10, windowMs: 60000, lockoutMs: 300000, exemptLoopback: false }
    },
    tailscale: { mode: "off", resetOnExit: false },
    remote: { enabled: false },
    reload: { mode: "restart", debounceMs: 1000, deferralTimeoutMs: 15000 },
    http: {
      endpoints: { chatCompletions: { enabled: false }, responses: { enabled: false } },
      securityHeaders: { strictTransportSecurity: "max-age=31536000; includeSubDomains" }
    },
    nodes: {
      browser: { mode: "manual", node: "${VERA_OPENCLAW_NODE_ID}" },
      pairing: { autoApproveCidrs: [] },
      allowCommands: ["browser.proxy"],
      denyCommands: [
        "system.run", "system.which", "camera.snap", "camera.clip", "screen.record",
        "location.get", "sms.search", "sms.send", "contacts.search", "calendar.events",
        "notifications.list", "notifications.actions"
      ]
    },
    trustedProxies: [],
    allowRealIpFallback: false,
    tools: {
      allow: [],
      deny: [
        "browser", "nodes", "gateway", "exec", "process", "read", "write", "edit",
        "apply_patch", "message", "cron", "sessions_spawn", "sessions_send", "web_search", "web_fetch"
      ]
    },
    sessionIdleTtlMs: 60000
  }
}
```

Do not add model providers, API keys, agents, channels, hooks, skills, MCP servers, or inline secret values.

- [ ] **Step 4: Create the founder local node config**

```json5
{
  meta: { lastTouchedVersion: "2026.6.33" },
  env: { shellEnv: { enabled: false } },
  update: { checkOnStart: false, auto: { enabled: false } },
  logging: { level: "info", consoleLevel: "info", redactSensitive: "tools" },
  plugins: { enabled: false, allow: [], deny: [] },
  nodeHost: { browserProxy: { enabled: true, allowProfiles: ["vera-zillow"] } }
}
```

This file is an example to merge into the founder-controlled local OpenClaw config. It contains no gateway token, password, cookie, browser path, or node identity.

- [ ] **Step 5: Validate both the upstream schema and Vera invariants**

The verifier must parse JSON5 through the pinned OpenClaw CLI, not a hand-copied schema:

```bash
OPENCLAW_CONFIG_PATH=infra/maritime/openclaw/openclaw.json5 \
  pnpm --filter @vera/worker exec openclaw config validate --json
```

Then enforce the exact negative invariants in the unit test, require only `browser.proxy`, and reject any key or string matching `password`, `cookie`, `storage`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `send`, `apply`, `payment`, `upload`, or `download` outside the explicit deny list.

Add:

```json
"verify:openclaw-config": "tsx scripts/verify-openclaw-config.ts"
```

- [ ] **Step 6: Run config tests**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-openclaw-config.unit.test.ts
pnpm verify:openclaw-config
```

Expected: PASS; OpenClaw reports the config valid and the Vera verifier reports `OpenClaw founder gateway policy validated.`

- [ ] **Step 7: Commit the enforced gateway policy**

```bash
git add infra/maritime/openclaw scripts/verify-openclaw-config.ts scripts/verify-openclaw-config.unit.test.ts package.json infra/maritime/OPENCLAW.md
git commit -m "feat: enforce least privilege OpenClaw gateway"
```

### Task 3: Upload Gateway Configuration Through the Supported Maritime API

> **Reconciliation update (2026-07-22): deferred until after Task 9 read-only inventory.** The
> founder already has a Maritime/OpenClaw agent. Do not build or invoke this uploader before the
> authenticated inventory proves the existing configuration needs a change. Reconfirm the file
> endpoint, authentication scheme, payload, destination semantics, overwrite behavior, and required
> restart from the installed `maritime guide --json` and current official Provisioning API. Then
> present the exact diff and obtain separate operator approval before any upload. If the existing
> agent is already compliant, omit this task entirely.

**Files:**
- Create: `scripts/maritime-upload-openclaw-config.ts`
- Create: `scripts/maritime-upload-openclaw-config.unit.test.ts`
- Modify: `package.json`
- Modify: `infra/maritime/README.md`
- Modify: `infra/maritime/ENVIRONMENT.md`

**Interfaces:**
- Consumes: `MARITIME_TOKEN`, exact `VERA_MARITIME_GATEWAY_AGENT_ID`, `MARITIME_API_URL`, and validated config file.
- Produces: one custom-files API request placing `openclaw.json` in `/data/.openclaw` with `run_on_deploy: false`.

- [ ] **Step 1: Write HTTP contract tests**

```ts
it("uploads only the reviewed config to the exact gateway agent", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  await uploadOpenClawConfig({
    apiUrl: "https://api.maritime.sh",
    token: "operator-secret",
    gatewayAgentId: "agent_123",
    configText: "{ gateway: { auth: { token: '${OPENCLAW_GATEWAY_TOKEN}' } } }",
    fetchImpl
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.maritime.sh/api/v1/agents/agent_123/files",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-API-Key": "operator-secret" }),
      body: JSON.stringify({ files: [{ path: "openclaw.json", content: expect.any(String), executable: false, run_on_deploy: false, target_dir: "/data/.openclaw" }] })
    })
  );
});
```

Add tests for missing token, invalid agent ID, non-HTTPS API URL, redirects, timeout, 401/403/429/5xx, oversized config, inline secret detection, and absence of token/config content from diagnostics.

- [ ] **Step 2: Run and confirm the uploader is absent**

Run: `pnpm exec vitest run --project unit scripts/maritime-upload-openclaw-config.unit.test.ts`

Expected: FAIL because the uploader does not exist.

- [ ] **Step 3: Implement the deploy-scoped operator client**

Validate agent IDs with `/^[A-Za-z0-9_-]{1,160}$/u`, allow only exact HTTPS `MARITIME_API_URL`, reject config over `128 KiB`, call `pnpm verify:openclaw-config` before upload in the CLI entry point, set `redirect: "error"`, and combine caller cancellation with `AbortSignal.timeout(10_000)`.

Map provider results to safe codes only:

```ts
type MaritimeConfigUploadCode =
  | "maritime_config_authentication_failed"
  | "maritime_config_rate_limited"
  | "maritime_config_unavailable"
  | "maritime_config_rejected";
```

Print only `{ event: "openclaw_config_uploaded", gatewayAgentIdHash, configSha256 }`.

- [ ] **Step 4: Add the explicit operator command**

```json
"maritime:upload-openclaw-config": "tsx scripts/maritime-upload-openclaw-config.ts"
```

The command reads `MARITIME_TOKEN` from the protected local environment. It never accepts the token as a CLI argument.

- [ ] **Step 5: Run unit tests with no live request**

Run: `pnpm exec vitest run --project unit scripts/maritime-upload-openclaw-config.unit.test.ts`

Expected: PASS; no network call occurs outside the mock.

- [ ] **Step 6: Commit the supported configuration path**

```bash
git add scripts/maritime-upload-openclaw-config.ts scripts/maritime-upload-openclaw-config.unit.test.ts package.json infra/maritime/README.md infra/maritime/ENVIRONMENT.md
git commit -m "feat: add Maritime OpenClaw config upload"
```

### Task 4: Require Immutable Release Evidence

**Files:**
- Create: `infra/maritime/release-manifest.schema.json`
- Create: `scripts/verify-release-manifest.ts`
- Create: `scripts/verify-release-manifest.unit.test.ts`
- Modify: `infra/maritime/validate.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: a generated operator manifest path in `VERA_RELEASE_MANIFEST_PATH`.
- Produces: validation that both images use digests and have SBOM, provenance, signature/review, vulnerability scan, source revision, build time, and rollback identity.

- [ ] **Step 1: Write manifest verifier tests**

```ts
it("rejects mutable images and missing evidence", () => {
  expect(validateReleaseManifest({
    schemaVersion: 1,
    releaseCommit: "a".repeat(40),
    worker: { image: "ghcr.io/example/vera-worker:latest" },
    openclaw: { image: "ghcr.io/openclaw/openclaw:2026.6.33" }
  })).toEqual(expect.arrayContaining([
    expect.stringContaining("worker digest"),
    expect.stringContaining("OpenClaw digest"),
    expect.stringContaining("SBOM"),
    expect.stringContaining("provenance")
  ]));
});
```

- [ ] **Step 2: Run and confirm the verifier is missing**

Run: `pnpm exec vitest run --project unit scripts/verify-release-manifest.unit.test.ts`

Expected: FAIL because no schema/verifier exists.

- [ ] **Step 3: Define the closed release evidence schema**

Require this closed schema shape for both components:

```ts
interface ReleaseManifest {
  readonly schemaVersion: 1;
  readonly releaseCommit: string; // /^[a-f0-9]{40}$/
  readonly createdAt: string; // ISO-8601 instant
  readonly worker: {
    readonly image: string; // OCI ref matching /@sha256:[a-f0-9]{64}$/
    readonly sourceCommit: string; // exactly releaseCommit
    readonly sbomSha256: string; // /^[a-f0-9]{64}$/
    readonly provenanceVerified: true;
    readonly signatureVerified: true;
    readonly vulnerabilityReview: { readonly critical: 0; readonly highAccepted: 0; readonly scanner: string; readonly databaseUpdatedAt: string };
  };
  readonly openclaw: {
    readonly image: "ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee";
    readonly version: "2026.6.33";
    readonly upstreamCommit: "7af0cfc";
    readonly sbomSha256: string;
    readonly provenanceVerified: true;
    readonly signatureVerified: true;
    readonly vulnerabilityReview: { readonly critical: 0; readonly highAccepted: 0; readonly scanner: string; readonly databaseUpdatedAt: string };
  };
  readonly rollback: { readonly workerImage: string; readonly openclawImage: string };
}
```

If upstream OpenClaw has no verifiable signature/provenance, do not set the booleans optimistically. Mirror the reviewed digest into the founder registry, generate an SBOM, attach a signed provenance statement referencing the upstream digest, and record that Vera attests the reviewed mirror—not an upstream signature. A missing evidence chain is a release no-go.

- [ ] **Step 4: Add release artifact commands**

Document and validate these exact operator patterns:

```bash
docker buildx build --platform linux/amd64 \
  --provenance=mode=max --sbom=true \
  --tag "$VERA_WORKER_IMAGE_REPOSITORY:$(git rev-parse HEAD)" \
  --metadata-file "$TMPDIR/vera-worker-build-metadata.json" \
  --push .
cosign verify-attestation --type https://slsa.dev/provenance/v1 "$VERA_WORKER_IMAGE_REF"
cosign verify-attestation --type https://spdx.dev/Document "$VERA_WORKER_IMAGE_REF"
trivy image --exit-code 1 --severity CRITICAL "$VERA_WORKER_IMAGE_REF"
```

Do not commit the generated manifest if it contains private registry/deployment references. Add `/release-evidence/private/` to `.gitignore`; commit only a sanitized evidence summary later.

- [ ] **Step 5: Extend Maritime validation**

`pnpm maritime:validate` must now run the worker image verifier, OpenClaw config verifier, and release-manifest verifier when `VERA_RELEASE_MANIFEST_PATH` is present. Without a manifest it may validate local assets but must print `live release evidence not supplied` and must not claim deploy readiness.

- [ ] **Step 6: Run local manifest tests**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-release-manifest.unit.test.ts
pnpm maritime:validate
```

Expected: unit PASS; local asset validation PASS with the explicit non-deployable evidence warning.

- [ ] **Step 7: Commit release evidence enforcement**

```bash
git add infra/maritime/release-manifest.schema.json scripts/verify-release-manifest.ts scripts/verify-release-manifest.unit.test.ts infra/maritime/validate.mjs package.json .gitignore docs/SECURITY_REVIEW.md
git commit -m "build: require immutable release evidence"
```

### Task 5: Correct the Maritime Topology, Public Surface, and Economics

**Files:**
- Modify: `infra/maritime/README.md`
- Modify: `infra/maritime/OPENCLAW.md`
- Modify: `infra/maritime/ENVIRONMENT.md`
- Modify: `infra/maritime/COSTS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: exact Maritime CLI 1.7.0 commands and supported OpenClaw custom-file configuration path.
- Produces: reproducible operator-controlled create/deploy/trigger/rotation/rollback instructions.

- [ ] **Step 1: Replace the worker create command and cost assumption**

Use:

```bash
maritime create vera-worker --framework custom --idle 120 --port 8080
```

There is no `--public`. The five-minute trigger can wake the worker; a 120-second idle timeout permits roughly three minutes asleep between idle reconciliations. State that actual billing must be checked in the Maritime dashboard and that an intentionally always-on worker requires a separate cost/reliability decision.

- [ ] **Step 2: Keep only the gateway public and digest-pinned**

Use:

```bash
maritime create vera-openclaw-gateway --template openclaw --always-on --public --port 18789
maritime deploy vera-openclaw-gateway --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
```

Immediately upload the reviewed config, set `OPENCLAW_CONFIG_PATH=/data/.openclaw/openclaw.json`, `OPENCLAW_HEADLESS=true`, `OPENCLAW_GATEWAY_TOKEN`, and `VERA_OPENCLAW_NODE_ID`, then restart. Do not set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, channel credentials, or browser credentials on the gateway.

- [ ] **Step 3: Document every remaining public gateway surface**

Use this exact table:

```markdown
| Surface | Method/protocol | Authentication | Payload/timeout | Expected denial/success |
| --- | --- | --- | --- | --- |
| Gateway transport | WSS upgrade on Maritime public host | OpenClaw token plus paired device identity for node role | 15-second pre-auth handshake; schema-bounded gateway frames | Missing/invalid token denied; unpaired node denied; paired founder node accepted |
| Control UI `/` | GET | None reaches route | No body | `404` because `gateway.controlUi.enabled=false` |
| `/v1/chat/completions` | POST | Token checked before any enabled handler | Disabled | `404`; no model/provider configured |
| `/v1/responses` | POST | Token checked before any enabled handler | Disabled | `404`; no model/provider configured |
| `/tools/invoke` | POST | Token required | OpenClaw request limit; Vera denies all configured tool names | `401` without token; authenticated invocation denied |
| Canvas/A2UI paths | GET | Gateway policy | No Vera content is published | `404`; any reachable content is a release blocker |
| Eager browser-control HTTP server | Separate opt-in server | Not configured | Environment flag absent | No listener; enabling it is a release blocker |
```

State Maritime terminates public TLS and forwards to the container port; no direct container IP/port or raw CDP endpoint is published.

- [ ] **Step 4: Document gateway token rotation and emergency stop**

Rotation order:

1. Activate `VERA_BROWSER_DISABLED=1` and source kill switches.
2. Allow in-flight jobs to finish or cancel by policy; preserve canonical job/audit state.
3. Generate a new 32-byte random token locally without printing it.
4. Update the Maritime gateway secret, Vera worker secret, and founder local node protected environment.
5. Restart gateway and worker; reconnect/re-pair only the exact founder node if required.
6. Run config, health, node, unauthorized, and capture smoke tests.
7. Remove the old token from every secret store and protected local environment.

Emergency stop is kill switches first, then `maritime stop vera-openclaw-gateway`; never delete the agent or PostgreSQL state during incident containment.

- [ ] **Step 5: Document exact browser data flow**

```text
Founder browser profile (password/cookies/storage stay local)
  -> local OpenClaw node reads the user-selected exact Zillow tab
  -> minimum page evidence transits TLS/WSS through the Maritime gateway
  -> Vera worker validates job/user/node/profile/URL/policy/hash/result schema
  -> accepted RawListing evidence and structured provenance persist in PostgreSQL
  -> logs/metrics contain only correlation IDs, enums, timings, counts, and safe codes
```

State plainly that required page content leaves the local machine during hosted capture; only authentication/session artifacts remain local.

- [ ] **Step 6: Validate documentation against local assets**

Run: `pnpm maritime:validate`

Expected: PASS local asset checks; no `--public` worker, no 600-second idle, no gateway model key, no tag-only OpenClaw deploy.

- [ ] **Step 7: Commit topology corrections**

```bash
git add infra/maritime docs/ARCHITECTURE.md docs/SECURITY.md docs/SECURITY_REVIEW.md .env.example
git commit -m "docs: harden Maritime founder topology"
```

### Task 6: Fail Closed on Invalid Hosted Runtime Configuration

**Files:**
- Create: `apps/web/lib/server/runtime-security-config.ts`
- Create: `apps/web/lib/server/runtime-security-config.unit.test.ts`
- Create: `apps/worker/src/runtime-security-config.ts`
- Create: `apps/worker/src/runtime-security-config.unit.test.ts`
- Create: `apps/worker/src/postgres-runtime.unit.test.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/browser-agent-service.ts`
- Modify: `apps/web/lib/server/maritime-dispatch.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`
- Modify: `.env.example`
- Modify: `infra/maritime/ENVIRONMENT.md`

**Interfaces:**
- Consumes: server environment only.
- Produces: `parseWebRuntimeSecurityConfig(environment)` and `parseWorkerRuntimeSecurityConfig(environment)` with no secret values exposed through errors or serialization.

- [ ] **Step 1: Write table-driven fail-closed tests**

```ts
it.each([
  ["public secret", { NEXT_PUBLIC_OPENCLAW_GATEWAY_TOKEN: "secret" }, "public_secret_name_forbidden"],
  ["plaintext gateway", { OPENCLAW_GATEWAY_URL: "ws://gateway.example.test" }, "gateway_tls_required"],
  ["short gateway token", { OPENCLAW_GATEWAY_TOKEN: "short" }, "gateway_token_invalid"],
  ["missing founder list", { VERA_BROWSER_DISABLED: "0", VERA_BROWSER_FOUNDER_USER_IDS: "" }, "founder_allowlist_missing"],
  ["missing Maritime audience", { VERA_MARITIME_WORKER_AGENT_ID: "" }, "maritime_worker_agent_missing"],
  ["partial notifications", { VERA_NOTIFICATIONS_DISABLED: "0", VERA_VAPID_PRIVATE_KEY: "" }, "notification_configuration_incomplete"],
  ["partial Gmail", { VERA_GMAIL_ALERTS_DISABLED: "0", VERA_GOOGLE_INTEGRATION_CLIENT_SECRET: "" }, "gmail_configuration_incomplete"]
])("rejects %s with a safe code", (_name, patch, code) => {
  expect(() => parseWorkerRuntimeSecurityConfig({ ...validWorkerEnvironment, ...patch })).toThrowError(expect.objectContaining({ code }));
});
```

Add a test that serializing every thrown error cannot reveal any configured token, API key, client secret, credential keyring, or database password.

- [ ] **Step 2: Run and confirm the parsers are absent**

Run:

```bash
pnpm exec vitest run --project unit apps/web/lib/server/runtime-security-config.unit.test.ts apps/worker/src/runtime-security-config.unit.test.ts
```

Expected: FAIL because both parser modules do not exist.

- [ ] **Step 3: Implement the web parser**

```ts
export interface WebRuntimeSecurityConfig {
  readonly browserDisabled: boolean;
  readonly founderBrowserUserIds: string | undefined;
  readonly maritimeWorkerAgentId: string | null;
  readonly maritimeGatewayAgentId: string | null;
}

export function parseWebRuntimeSecurityConfig(environment: Readonly<Record<string, string | undefined>>): WebRuntimeSecurityConfig {
  rejectPublicSecretNames(environment);
  const browserDisabled = parseKillSwitch(environment.VERA_BROWSER_DISABLED, true);
  const founderBrowserUserIds = environment.VERA_BROWSER_FOUNDER_USER_IDS?.trim() || undefined;
  if (!browserDisabled) {
    assertValidFounderList(founderBrowserUserIds);
    requireSafeValue(environment, "VERA_MARITIME_WORKER_AGENT_ID");
    requireSafeValue(environment, "VERA_MARITIME_GATEWAY_AGENT_ID");
    requireSecretValue(environment, "MARITIME_API_KEY", 24);
  }
  return {
    browserDisabled,
    founderBrowserUserIds,
    maritimeWorkerAgentId: environment.VERA_MARITIME_WORKER_AGENT_ID?.trim() || null,
    maritimeGatewayAgentId: environment.VERA_MARITIME_GATEWAY_AGENT_ID?.trim() || null
  };
}
```

Errors carry safe enum codes only. The web process does not need the OpenClaw gateway token because it creates durable dispatches; the worker owns gateway execution.

- [ ] **Step 4: Implement the worker parser**

Require in `serve`/production composition:

- valid PostgreSQL configuration through the existing parser;
- `VERA_MARITIME_ENVIRONMENT` is `staging` or `production` when `NODE_ENV=production`;
- exact worker and gateway agent identifiers;
- HTTPS `MARITIME_API_URL` and server-only runtime API key;
- when browser is enabled: valid founder UUID list, `wss:` gateway URL, gateway token length `32..4096`, exact profile `vera-zillow`, and absolute executable `/workspace/apps/worker/node_modules/.bin/openclaw` in production;
- when Gmail is enabled: integration client ID/secret and credential keyring;
- when notifications are enabled: VAPID subject/public/private values and credential keyring;
- no key beginning `NEXT_PUBLIC_` may contain `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `CREDENTIAL`, or `API_KEY`.

Return a typed object consumed by `createPostgresWorkerRuntime`; remove ad hoc boolean/default parsing from that function.

- [ ] **Step 5: Make application composition validate before opening resources**

In `createPostgresApplication`, call `parseWebRuntimeSecurityConfig(environment)` before `openPostgresConnection`. In `createPostgresWorkerRuntime`, call the worker parser before opening the pool. Pass the parsed founder list, kill switches, IDs, endpoints, and capability flags into services; do not reread `process.env` below the composition root.

- [ ] **Step 6: Run config and composition tests**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/runtime-security-config.unit.test.ts \
  apps/worker/src/runtime-security-config.unit.test.ts \
  apps/web/lib/server/application.unit.test.ts \
  apps/worker/src/postgres-runtime.unit.test.ts
```

Expected: PASS; invalid production configuration creates no PostgreSQL pool, Maritime client, OpenClaw provider, Google client, or notification provider.

- [ ] **Step 7: Commit runtime validation**

```bash
git add apps/web/lib/server/runtime-security-config.ts apps/web/lib/server/runtime-security-config.unit.test.ts apps/worker/src/runtime-security-config.ts apps/worker/src/runtime-security-config.unit.test.ts apps/web/lib/server/application.ts apps/web/lib/browser-agent-service.ts apps/web/lib/server/maritime-dispatch.ts apps/worker/src/postgres-runtime.ts .env.example infra/maritime/ENVIRONMENT.md
git commit -m "fix: validate hosted runtime security config"
```

### Task 7: Build the Unified Offline and Live Staging Harness

**Files:**
- Create: `scripts/staging/founder-release-smoke.ts`
- Create: `scripts/staging/founder-release-smoke.unit.test.ts`
- Create: `scripts/staging/gateway-http-smoke.ts`
- Create: `scripts/staging/gateway-http-smoke.unit.test.ts`
- Modify: `packages/connectors/src/maritime.staging.test.ts`
- Modify: `packages/connectors/src/openclaw-current-tab.live.test.ts`
- Modify: `packages/notifications/src/web-push.staging.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: explicit `VERA_FOUNDER_STAGING_SMOKE=1`, release manifest, Maritime token, staging base URL, protected Playwright storage-state path, managed test user ID, exact Zillow URL/node/profile, gateway URL/token, and optional readonly Gmail/Web Push staging configuration.
- Produces: one sanitized JSON result and Markdown summary with every phase marked `passed`, `failed`, `skipped_with_blocker`, or `not_applicable`.

- [ ] **Step 1: Write harness validation and redaction tests**

```ts
it("refuses live execution without the explicit flag and complete immutable release identity", () => {
  expect(() => parseFounderStagingEnvironment({})).toThrow("VERA_FOUNDER_STAGING_SMOKE must be exactly 1");
});

it("redacts every configured secret from the report", () => {
  const report = serializeSafeSmokeReport(rawReport, ["maritime-secret", "gateway-secret", "session-cookie"]);
  expect(report).not.toMatch(/maritime-secret|gateway-secret|session-cookie/);
  expect(report).toContain("payload_hash_mismatch");
});

it("runs negative controls even when a positive phase fails", async () => {
  const result = await runFounderReleaseSmoke(dependenciesWithFailedCapture);
  expect(result.phases.find((phase) => phase.id === "gateway_unauthorized")?.status).toBe("passed");
  expect(result.outcome).toBe("failed");
});
```

- [ ] **Step 2: Run and confirm the harness is absent**

Run: `pnpm exec vitest run --project unit scripts/staging/founder-release-smoke.unit.test.ts scripts/staging/gateway-http-smoke.unit.test.ts`

Expected: FAIL because the staging modules do not exist.

- [ ] **Step 3: Implement the gateway HTTP negative matrix**

With a mockable `fetch`, check:

```ts
const checks = [
  { id: "control_ui_disabled", method: "GET", path: "/", expected: [404] },
  { id: "chat_api_disabled", method: "POST", path: "/v1/chat/completions", expected: [401, 404] },
  { id: "responses_api_disabled", method: "POST", path: "/v1/responses", expected: [401, 404] },
  { id: "tools_unauthorized", method: "POST", path: "/tools/invoke", expected: [401, 403] },
  { id: "canvas_absent", method: "GET", path: "/__openclaw__/canvas/", expected: [404] },
  { id: "a2ui_absent", method: "GET", path: "/__openclaw__/a2ui/", expected: [404] }
] as const;
```

Use `redirect: "error"`, a five-second timeout, a 1 KiB JSON body, and never attach the valid gateway token in this unauthenticated phase. Unexpected 2xx/3xx is a release failure.

- [ ] **Step 4: Implement the phase runner**

Run phases in this fixed order and continue collecting safe failures:

1. release manifest verification;
2. Maritime CLI/API identity and worker/gateway status;
3. deployed image digest equality;
4. worker readiness evidence from Maritime (worker remains non-public);
5. OpenClaw `--version`, `config validate --json`, `doctor --lint --non-interactive --json`, `security audit --deep`, and `health`;
6. gateway unauthenticated/disabled-route matrix;
7. exact paired node/profile/version/heartbeat check;
8. founder user allowlist and browser/source kill-switch check;
9. policy-disabled job cancellation;
10. offline-node `deferred_node_offline` with no RawListing/cursor change;
11. login/CAPTCHA/manual blocker with no success/cursor change;
12. exact allowlisted current-tab capture to canonical listing;
13. identical capture replay with no duplicate raw/canonical row;
14. off-allowlist URL denial;
15. payload-hash mismatch/replayed result denial;
16. readonly Gmail scheduled ingestion when configured, otherwise `skipped_with_blocker`;
17. one idempotent Web Push delivery when configured, otherwise `skipped_with_blocker`;
18. gateway restart/unavailability produces retryable/deferred state, never empty success;
19. source kill switch cancels queued/future execution;
20. rollback identity and command dry validation.

The harness may call existing opt-in staging helpers, authenticated Vera APIs through a Playwright storage state outside the repository, Maritime APIs, OpenClaw CLI, and PostgreSQL read-only verification. It must not create messages, applications, payments, calendar events, arbitrary browser navigation, or delete any agent/database.

- [ ] **Step 5: Add root commands with default skip behavior**

```json
"test:staging:founder-release": "tsx scripts/staging/founder-release-smoke.ts",
"test:staging:gateway-http": "tsx scripts/staging/gateway-http-smoke.ts"
```

When the live flag is not exactly `1`, print `Founder staging smoke skipped: explicit live flag absent.` and exit `0`. When the flag is `1`, any failed or blocker-skipped mandatory phase exits nonzero.

Write private raw results only below `release-evidence/private/` and keep that directory ignored. The committed summary contains no agent IDs, node IDs, user IDs, URLs with query strings, tokens, page text, email addresses, phone numbers, or PostgreSQL connection details.

- [ ] **Step 6: Run all offline harness tests**

Run:

```bash
pnpm exec vitest run --project unit scripts/staging/founder-release-smoke.unit.test.ts scripts/staging/gateway-http-smoke.unit.test.ts
pnpm test:staging:founder-release
```

Expected: unit PASS; default command exits `0` with the explicit skip line and makes no network call.

- [ ] **Step 7: Commit the staging harness**

```bash
git add scripts/staging packages/connectors/src/maritime.staging.test.ts packages/connectors/src/openclaw-current-tab.live.test.ts packages/notifications/src/web-push.staging.test.ts package.json .gitignore
git commit -m "test: add founder release staging matrix"
```

### Task 8: Run Every Local Release Gate Before Requesting Maritime Access

**Files:**
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: all tasks in this and the two companion plans.
- Produces: proof that only live Maritime/OpenClaw/operator stages remain.

- [ ] **Step 1: Run static boundary gates**

Run:

```bash
pnpm format:check
pnpm verify:calendar-boundaries
pnpm verify:gmail-boundaries
pnpm verify:db-boundaries
pnpm verify:web-mutation-boundaries
pnpm verify:browser-boundaries
pnpm verify:maritime-boundaries
pnpm verify:worker-image-boundaries
pnpm verify:openclaw-config
pnpm maritime:validate
```

Expected: every command exits `0`; `maritime:validate` states that live release evidence is still required.

- [ ] **Step 2: Run unit, demo, and PostgreSQL tests**

Run:

```bash
pnpm test:unit
pnpm test:integration
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres
pnpm test:e2e
```

Expected: PASS; default suites call no live Maritime, OpenClaw, Google, OpenAI, or push provider.

- [ ] **Step 3: Run dependency and build gates**

Run:

```bash
pnpm audit --audit-level high
pnpm lint
pnpm typecheck
pnpm build
docker build --tag vera-worker:local-security-review .
```

Expected: no unaccepted high/critical advisory, all code gates PASS, and the worker image builds non-root.

- [ ] **Step 4: Record local evidence and notify the user of the access boundary**

Update `docs/SECURITY_REVIEW.md` with exact results. Then tell the user:

> Local hardening and all mock/database/build gates are complete. Maritime authentication is needed now for read-only deployment inspection and the operator-controlled staging release. Please run `maritime login` locally, or set a scoped `MARITIME_TOKEN` in your protected shell; do not paste the token into chat. I will verify `maritime whoami --json` without printing credentials before any deploy command.

Do not request the token before this step.

- [ ] **Step 5: Commit local release-gate evidence**

```bash
git add docs/SECURITY_REVIEW.md
git commit -m "docs: record local founder release gates"
```

### Task 9: Inspect Maritime and Prepare an Operator-Controlled Deploy

**Files:**
- Create: `release-evidence/private/founder-release-manifest.json` (ignored)
- Create: `release-evidence/private/maritime-inspection.json` (ignored)
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: locally authenticated `maritime-cli@1.7.0`, deploy-scoped operator token, and live account state.
- Produces: read-only inventory, immutable image manifest, and exact deploy/rollback proposal; no deploy occurs until the user approves it.

- [ ] **Step 1: Install and verify the exact CLI without exposing auth**

Run:

```bash
npm install --global maritime-cli@1.7.0
maritime --version
maritime whoami --json
maritime guide --json
```

Expected: CLI version `1.7.0`, authenticated identity metadata with no token value, and a current machine-readable command contract. If unauthenticated, stop and ask the user to complete `maritime login` locally.

- [ ] **Step 2: Perform read-only deployment inventory**

Run:

```bash
maritime list --json
maritime info vera-worker --json
maritime info vera-openclaw-gateway --json
maritime status vera-worker --json
maritime status vera-openclaw-gateway --json
maritime history vera-worker --json
maritime history vera-openclaw-gateway --json
maritime triggers vera-worker --json
maritime env list vera-worker --json
maritime env list vera-openclaw-gateway --json
```

Store raw output only in the ignored private evidence directory with restrictive permissions. Create a sanitized summary containing statuses, version/digest presence, trigger cadence, environment variable names, public/private state, and agent ID hashes—not values or raw IDs.

- [ ] **Step 3: Reconcile the live account with the plan**

Treat these as deploy blockers:

- worker is public;
- worker idle timeout is not `120` seconds;
- gateway image is not the exact reviewed digest;
- gateway has model/channel credentials;
- config path is absent or points outside `/data/.openclaw/openclaw.json`;
- multiple user nodes/profiles are paired or automatic routing is enabled;
- five-minute trigger is missing/duplicated;
- environment contains browser password/cookie/storage/profile values;
- runtime Maritime key has deploy/manage scope rather than the narrow wake/status scope;
- operator key is reused in application runtime.

- [ ] **Step 4: Build the immutable worker and private release manifest**

Use the BuildKit, attestation, scanner, and verifier commands from Task 4. Resolve the resulting digest from build metadata and write the complete private manifest. Run:

```bash
VERA_RELEASE_MANIFEST_PATH=release-evidence/private/founder-release-manifest.json pnpm maritime:validate
```

Expected: PASS with no evidence warning.

- [ ] **Step 5: Present the exact change set and request live-deploy approval**

Report the current versus desired worker visibility/idle/image, gateway digest/config, trigger, secret-name changes, pairing impact, estimated interruption, rollback digests, and commands. Do not run `maritime create`, `deploy`, `env set/import/reload`, `restart`, or config upload until the user approves this exact live action.

### Task 10: Execute the Approved Founder Staging Release and Smoke Matrix

**Files:**
- Create: `release-evidence/private/founder-staging-smoke.json` (ignored)
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: explicit user approval from Task 8, immutable release manifest, protected operator/runtime/gateway secrets, and founder local node access.
- Produces: deployed founder staging, sanitized evidence, and rollback-ready state.

- [ ] **Step 1: Apply PostgreSQL release state first**

Run from the controlled operator environment:

```bash
DATABASE_URL="$STAGING_DATABASE_URL" pnpm db:migrate
DATABASE_URL="$STAGING_DATABASE_URL" pnpm db:seed
```

Expected: five migrations current; seed reports only global policy manifests and no private row creation.

- [ ] **Step 2: Create or reconcile the private worker**

For first provision:

```bash
maritime create vera-worker --framework custom --idle 120 --port 8080
```

Deploy the exact manifest worker digest:

```bash
maritime deploy vera-worker --source docker --image "$VERA_WORKER_IMAGE_REF" --wait
maritime status vera-worker --json
```

Expected: running/ready when awake and no public URL.

- [ ] **Step 3: Create or reconcile the public gateway**

For first provision and immutable deploy:

```bash
maritime create vera-openclaw-gateway --template openclaw --always-on --public --port 18789
maritime deploy vera-openclaw-gateway --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
pnpm maritime:upload-openclaw-config
maritime env reload vera-openclaw-gateway
maritime restart vera-openclaw-gateway
maritime status vera-openclaw-gateway --json
```

Expected: exact digest, always-on public TLS host, validated config loaded, no model/channel secret.

- [ ] **Step 4: Configure the five-minute wake trigger in the supported dashboard**

The current CLI lists but does not document trigger creation. In the Maritime dashboard, add exactly one UTC cron trigger named `vera-production-reconcile` with `*/5 * * * *`, targeting `vera-worker`. Then run:

```bash
maritime triggers vera-worker --json
```

Expected: one enabled five-minute trigger; no browser-specific scheduled trigger.

- [ ] **Step 5: Pair and constrain the founder local node**

On the founder machine, merge `node.openclaw.json5`, provide the gateway token through the protected environment, and run:

```bash
openclaw --version
openclaw node run --host "$VERA_GATEWAY_HOST" --port 443 --tls --display-name "Vera Founder Browser"
```

On the authenticated operator client:

```bash
openclaw devices list
openclaw devices approve "$VERA_OPENCLAW_PAIRING_REQUEST_ID"
openclaw nodes status
openclaw nodes describe --node "$VERA_OPENCLAW_NODE_ID"
```

Approve only the exact founder node with `browser.proxy`; reject any unexpected declared command. The founder signs in manually in profile `vera-zillow`; Vera/Codex does not type or store the marketplace password.

- [ ] **Step 6: Run OpenClaw read-only diagnostics**

Run:

```bash
OPENCLAW_CONFIG_PATH=infra/maritime/openclaw/openclaw.json5 openclaw config validate --json
openclaw doctor --lint --non-interactive --json
openclaw security audit --deep
openclaw health
```

Expected: valid config, no unresolved error-severity doctor finding, no critical/high security finding, healthy gateway, exact node/profile/version. Never run doctor with `--fix`, `--repair`, `--force`, `--allow-exec`, or token-generation flags during validation.

- [ ] **Step 7: Run the unified staging matrix**

Run:

```bash
VERA_FOUNDER_STAGING_SMOKE=1 \
VERA_RELEASE_MANIFEST_PATH=release-evidence/private/founder-release-manifest.json \
pnpm test:staging:founder-release
```

Expected: every mandatory positive and failure phase passes. A Gmail/Web Push phase marked `skipped_with_blocker` prevents founder beta promotion even if browser capture succeeds.

- [ ] **Step 8: Exercise rollback without destroying state**

Validate the prior worker digest exists in history and the OpenClaw reviewed digest is pullable. If staging validation fails, run:

```bash
maritime deploy vera-worker --source docker --image "$VERA_PREVIOUS_WORKER_IMAGE_REF" --wait
maritime deploy vera-openclaw-gateway --source docker --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee --wait
pnpm maritime:upload-openclaw-config
maritime restart vera-openclaw-gateway
```

Database rollback uses the verified managed snapshot/new-database procedure only when application compatibility cannot be maintained; never reset PostgreSQL or fall back to SQLite.

### Task 11: Issue the Final Release Decision

**Files:**
- Create: `docs/RELEASE_READINESS.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DECISIONS/0007-maritime-openclaw-contract-boundaries.md`

**Interfaces:**
- Consumes: local acceptance evidence, immutable release manifest, live Maritime/OpenClaw diagnostics, staging matrix, and remaining findings.
- Produces: one explicit release outcome and blocker table.

- [ ] **Step 1: Write the readiness table**

```markdown
| Gate | Required evidence | Result | Blocking scope |
| --- | --- | --- | --- |
| Application boundaries | Founder allowlist, bounded mutations, Gmail read-only, nested log redaction | Pass/Fail with test links | Founder staging and beta |
| PostgreSQL | Migration 0004, seed safety, lease recovery, cleanup, restore rehearsal | Pass/Fail with command evidence | Founder staging and beta |
| Supply chain | Worker/OpenClaw digests, SBOM, provenance/signature, advisory review | Pass/Fail with manifest hash | Founder staging and beta |
| Maritime topology | Private worker, 120-second idle, exact trigger, narrow runtime key | Pass/Fail with sanitized inspection | Founder beta |
| OpenClaw | Enforced config, exact version, one paired node/profile, deep audit | Pass/Fail with safe codes | Founder beta |
| Positive path | Scheduled readonly ingestion, one notification, one exact current-tab capture | Pass/Fail | Founder beta |
| Failure paths | Disabled policy, offline node, manual blocker, replay/hash mismatch, gateway restart, kill switch | Pass/Fail | Founder beta |
| Privacy operations | Inventory, retention, disconnect, export/deletion rehearsal, backup expiry | Pass/Fail | Founder beta; self-service blocks multi-user beta |
```

- [ ] **Step 2: Choose exactly one outcome from evidence**

Use these rules:

- **No-go:** any critical/high finding open, any immutable identity missing, database restore failure, secret/session artifact leakage, or send/apply/pay capability exists.
- **Conditional founder staging:** all local gates pass but live Maritime/OpenClaw or provider phases remain incomplete.
- **Founder beta go:** every founder gate and live staging phase passes, with no critical/high or release-blocking medium finding open.
- **Multi-user beta go:** prohibited for this milestone; it additionally requires separate gateway isolation per user and self-service privacy lifecycle work.

Do not describe conditional founder staging as production-ready.

- [ ] **Step 3: Separate blockers by scope**

Create four lists: blocks founder staging, blocks founder beta, blocks broader beta, accepted founder-only limitations. Each item must link to a finding ID, owner, next action, and evidence needed to close.

- [ ] **Step 4: Update security finding statuses**

Mark `SEC-002`, `SEC-003`, `SEC-004`, and `SEC-012` resolved only when their live evidence exists. Preserve dates and prior status history. Any OpenClaw doctor/audit warning accepted for founder release becomes a new finding with explicit rationale and compensating control; do not suppress it in OpenClaw config merely to make the report green.

- [ ] **Step 5: Run the final full gate**

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera_test pnpm test:integration:postgres
pnpm build
VERA_RELEASE_MANIFEST_PATH=release-evidence/private/founder-release-manifest.json pnpm maritime:validate
```

Expected: every local command exits `0`; deploy validation uses the exact private manifest; live result is referenced by sanitized hash.

- [ ] **Step 6: Commit only sanitized release evidence**

```bash
git add docs/RELEASE_READINESS.md docs/SECURITY_REVIEW.md docs/SECURITY.md docs/ARCHITECTURE.md docs/DECISIONS/0007-maritime-openclaw-contract-boundaries.md
git commit -m "docs: record founder release readiness"
```

Expected: no tokens, raw IDs, private hosts, session state, page text, contact details, or unmasked logs in Git.
