# DigitalOcean Asynchronous Resource Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every disposable DigitalOcean resource identity before validation or polling and
correctly reconcile asynchronous certificate and Load Balancer creation across alternate 2xx
responses, transport ambiguity, interruption, restart, and cleanup.

**Architecture:** A closed atomic resource journal is the durable source of truth for one unique
acceptance run. The existing narrow DigitalOcean client returns bounded sanitized response
observations, while separate certificate and Load Balancer state machines distinguish creation
acknowledgement from final verified readiness and reconcile only exact run-specific identities.

**Tech Stack:** TypeScript 6, Node.js 24 native fetch/crypto/filesystem APIs, Vitest 4, DigitalOcean
v2 API, existing Vera infrastructure validators and CI.

## Global Constraints

- Keep the Gateway image exactly
  `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd`.
- Do not modify OpenClaw, the Gateway image, or the Droplet bootstrap architecture.
- Do not add a provider SDK, Terraform, a mutable image tag, or a public Droplet listener.
- Never persist an API token, authorization header, private key, Gateway token, pairing seed, or
  arbitrary provider payload.
- Journal directories must be mode `0700`; journal files must be mode `0600`.
- Persist a returned provider identity before validation, polling, or another mutation.
- Certificate verification is bounded to ten minutes with bounded polling and jitter.
- Reconciliation and cleanup use exact unique names only and reject multiple matches.
- DNS A creation remains forbidden until exact Load Balancer readback passes.
- No product behavior, landing-page DNS, rental-source behavior, or Milestone 13B changes.

---

### Task 1: Atomic private resource journal

**Files:**

- Create: `infra/digitalocean/browser-gateway/resource-journal.ts`
- Create: `infra/digitalocean/browser-gateway/resource-journal.unit.test.ts`
- Modify: `infra/digitalocean/browser-gateway/config.ts`
- Modify: `infra/digitalocean/browser-gateway/config.unit.test.ts`

**Interfaces:**

- Produces:
  `DigitalOceanResourceKind`,
  `ResourceJournalEntry`,
  `ResourceJournalSnapshot`,
  `openResourceJournal(input): Promise<ResourceJournal>`.
- `ResourceJournal.recordCreated(entry)` atomically persists one identity.
- `ResourceJournal.updateStatus(kind, id, status)` persists provider state.
- `ResourceJournal.markCleanup(kind, id, cleanupState)` persists deletion state.
- `ResourceJournal.find(kind, name)` returns only exact-name entries.

- [ ] **Step 1: Write failing journal schema and permission tests**

```ts
it("creates a closed mode-0600 journal in a mode-0700 directory", async () => {
  const journal = await openResourceJournal({
    path: join(directory, "resources.json"),
    runId: "20260729-12",
    now: fixedNow
  });
  await journal.recordCreated({
    kind: "certificate",
    name: "vera-m13a-do-cert-20260729-12",
    id: "00000000-0000-4000-8000-000000000012",
    status: "pending",
    createdAtUtc: fixedNow().toISOString()
  });
  expect((await stat(join(directory, "resources.json"))).mode & 0o777).toBe(0o600);
});
```

Add failures for a `0755` directory, `0644` existing journal, symlink, unknown resource kind,
unknown field, duplicate kind/name with a different ID, API-token-shaped value, authorization
header text, and non-ISO timestamp.

- [ ] **Step 2: Run the focused tests and confirm the module is missing**

Run:

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts
```

Expected: failure because `resource-journal.ts` does not exist.

- [ ] **Step 3: Implement the closed journal**

Use this exact resource union:

```ts
export type DigitalOceanResourceKind =
  | "dns_zone"
  | "certificate"
  | "droplet"
  | "firewall"
  | "tag"
  | "ssh_key"
  | "load_balancer"
  | "dns_record";
```

Use cleanup states `active | delete_pending | deleted | delete_failed`. Write a unique
same-directory temporary file using `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW`, mode `0600`, call
`FileHandle.sync()`, rename over the journal, then open and `sync()` the directory. Remove only the
known temporary file on a failed write.

- [ ] **Step 4: Implement restart validation and exact lookup**

Opening an existing journal must validate exact top-level and entry keys, run ID, modes, ISO
timestamps, resource kinds, cleanup states, provider IDs, and unique `(kind, name)` identity.
`recordCreated` is idempotent only for an identical existing entry.

- [ ] **Step 5: Run the journal and config tests**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/config.unit.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add infra/digitalocean/browser-gateway/resource-journal.ts \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/config.ts \
  infra/digitalocean/browser-gateway/config.unit.test.ts
git commit -m "feat: add atomic DigitalOcean resource journal"
```

### Task 2: Bounded provider response observations

**Files:**

- Modify: `infra/digitalocean/browser-gateway/digitalocean-api.ts`
- Modify: `infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts`

**Interfaces:**

- Produces:
  `DigitalOceanResponseObservation`,
  `DigitalOceanTransportError`,
  `DigitalOceanProviderError`.
- Adds
  `DigitalOceanClient.observe(method, path, body): Promise<DigitalOceanResponseObservation>`.
- Adds typed certificate and Load Balancer list/get/create helpers that return observations instead
  of collapsing all non-`201`/`202` outcomes.

- [ ] **Step 1: Write failing observation tests**

Cover:

```ts
expect(observation).toEqual({
  status: 202,
  headers: {
    contentType: "application/json",
    providerRequestId: "request-opaque"
  },
  bodyByteLength: 128,
  bodyTruncated: false,
  parsedBody: expect.any(Object)
});
```

Also prove bearer values and non-allowlisted headers are absent, bodies over 64 KiB are bounded,
invalid JSON is represented without echoing text, and timeout/network failures are typed transport
errors.

- [ ] **Step 2: Run the focused API tests and confirm failure**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
```

Expected: failures for missing observation and resource APIs.

- [ ] **Step 3: Implement observed requests**

Allowlist only `content-type`, `date`, `ratelimit-limit`, `ratelimit-remaining`,
`ratelimit-reset`, and the provider request-ID header when present. Never expose request headers.
Read at most 65,536 body bytes plus one byte to detect truncation.

- [ ] **Step 4: Add typed provider classifications**

Map `401`, `403`, `422`, and `429` to authentication, authorization, validation, and rate-limit
provider codes. Preserve numeric status in the typed error without including response bodies or
resource identities in its message.

- [ ] **Step 5: Run API tests**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add infra/digitalocean/browser-gateway/digitalocean-api.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
git commit -m "feat: observe DigitalOcean create responses safely"
```

### Task 3: Managed certificate state machine

**Files:**

- Create: `infra/digitalocean/browser-gateway/managed-certificate.ts`
- Create: `infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts`

**Interfaces:**

- Produces:
  `ensureManagedCertificate(input): Promise<ManagedCertificateResult>`.
- Produces:
  `cleanupManagedCertificate(input): Promise<ManagedCertificateCleanupResult>`.
- `ManagedCertificateResult` includes actual create status or `null`, acknowledgement class,
  persisted certificate ID, final state, and whether reconciliation occurred.

- [ ] **Step 1: Add the complete table-driven acknowledgement suite**

Cases:

- `201` with ID and verified;
- `201` with ID and pending;
- alternate 2xx with ID;
- alternate 2xx without ID plus one exact match;
- alternate 2xx without ID plus zero or multiple matches;
- malformed 2xx body with exact reconciliation;
- explicit `401`, `403`, `422`, and `429`;
- transport timeout after server-side creation.

Each success asserts `recordCreated` occurs before the first `getCertificate` or delay call.

- [ ] **Step 2: Add verification and restart tests**

Cover pending-to-verified, pending-to-error, timeout, missing persisted ID, identity mismatch,
interruption after creation, restart from journal, pre-create exact-name reconciliation, and
cross-run creation-time rejection.

- [ ] **Step 3: Add cleanup tests**

Cover persisted-ID deletion, exact-name fallback when no ID is present, pending/verified/error
states, post-delete absence verification, multiple-match rejection, and refusal to delete another
run.

- [ ] **Step 4: Run the tests and confirm the implementation is missing**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts
```

Expected: missing-module failure.

- [ ] **Step 5: Implement exact identity and acknowledgement rules**

Use exact set equality for DNS names, `type === "lets_encrypt"`, exact certificate name, exact
persisted ID, and creation time within the caller-supplied run window. Classify `201` as
`documented_create`; other 2xx as `create_acknowledged_nonstandard`; transport reconciliation as
`transport_reconciled`; and restart as `resumed_from_journal`.

- [ ] **Step 6: Implement bounded verification**

Default deadline: `600_000` ms. Default base poll interval: `10_000` ms. Add injected jitter bounded
to ±20%, clamp every delay to the remaining deadline, and never poll after `verified` or `error`.

- [ ] **Step 7: Run certificate tests**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add infra/digitalocean/browser-gateway/managed-certificate.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts
git commit -m "fix: reconcile asynchronous certificate creation"
```

### Task 4: Managed Load Balancer state machine

**Files:**

- Create: `infra/digitalocean/browser-gateway/managed-load-balancer.ts`
- Create: `infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts`

**Interfaces:**

- Produces:
  `ensureManagedLoadBalancer(input): Promise<ManagedLoadBalancerResult>`.
- Produces:
  `cleanupManagedLoadBalancer(input): Promise<ManagedLoadBalancerCleanupResult>`.

- [ ] **Step 1: Write the asynchronous acknowledgement tests**

Cover standard `202`, alternate 2xx, immediate ID persistence, no-ID exact reconciliation,
transport ambiguity, multiple exact matches, and restart from journal.

- [ ] **Step 2: Write full readback tests**

The accepted resource must match exact name, region, one Droplet ID, one HTTPS `443` to HTTP `18789`
rule with the exact certificate ID, TCP `18789` health check, external IPv4 Regional type, no HTTP
redirect, no PROXY protocol, and no unrelated forwarding rule. Cover delayed address/readiness,
provider error, mismatch, and timeout.

- [ ] **Step 3: Write cleanup and DNS-ordering tests**

Prove deletion uses only the persisted ID or one exact run-specific match. Prove the callback that
creates the DNS A record cannot run before complete persisted-ID readback succeeds.

- [ ] **Step 4: Run the tests and confirm missing implementation**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts
```

Expected: missing-module failure.

- [ ] **Step 5: Implement acknowledgement, persistence, reconciliation, and polling**

Use the same journal and typed response model as certificates. An acknowledged create remains
`load_balancer_creation_acknowledged` until exact readback has a public address and provider state
`active`.

- [ ] **Step 6: Run Load Balancer tests**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add infra/digitalocean/browser-gateway/managed-load-balancer.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts
git commit -m "fix: journal asynchronous Load Balancer creation"
```

### Task 5: Journal every stack mutation and independent cleanup

**Files:**

- Modify: `infra/digitalocean/browser-gateway/create-diagnostics-stack.ts`
- Modify: `infra/digitalocean/browser-gateway/cleanup-stack.ts`
- Modify: `infra/digitalocean/browser-gateway/lifecycle.unit.test.ts`

**Interfaces:**

- `createDiagnosticsStack` consumes a `ResourceJournal` and records tag, firewall, SSH key, and
  Droplet before continuing.
- `cleanupJournal(input)` independently reconciles and deletes active entries in dependency order.
- Existing manifest cleanup remains readable for historical evidence but is not the source of truth
  for new runs.

- [ ] **Step 1: Extend lifecycle tests with persistence order**

Assert this exact event prefix:

```text
create_tag
journal_tag
create_firewall
journal_firewall
create_ssh_key
journal_ssh_key
create_droplet
journal_droplet
poll_droplet
```

Add interruption after each create, restart cleanup, deleted-state persistence, and one provider
delete failure that still attempts all later resources.

- [ ] **Step 2: Run lifecycle tests and confirm failures**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts
```

- [ ] **Step 3: Integrate the journal into stack creation**

Create/open the journal before `createTag`. Use the unique resource name as the tag and DNS-zone ID,
and stringified numeric IDs for Droplet, SSH key, and DNS record entries.

- [ ] **Step 4: Implement independent journal cleanup**

Dependency order:

```text
load_balancer -> dns_record -> certificate -> droplet -> firewall -> ssh_key -> tag -> dns_zone
```

Set `delete_pending` before each provider call, `deleted` after verified absence, and
`delete_failed` on failure. Continue through all entries and return only resource-kind booleans.

- [ ] **Step 5: Run all lifecycle tests**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add infra/digitalocean/browser-gateway/create-diagnostics-stack.ts \
  infra/digitalocean/browser-gateway/cleanup-stack.ts \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts
git commit -m "fix: persist DigitalOcean lifecycle state before polling"
```

### Task 6: Static gates, runbook, and CI

**Files:**

- Modify: `scripts/verify-digitalocean-browser-gateway.ts`
- Modify: `scripts/verify-digitalocean-browser-gateway.unit.test.ts`
- Modify: `infra/digitalocean/browser-gateway/validate.sh`
- Modify: `infra/digitalocean/browser-gateway/README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Static verification consumes journal, certificate, and Load Balancer source files.
- CI runs all four focused infrastructure test files in addition to existing validation.

- [ ] **Step 1: Add failing static mutation tests**

Reject removal of atomic rename, file or directory sync, immediate certificate/LB journal writes,
exact-name reconciliation, ten-minute certificate deadline, cross-run rejection, dependency-ordered
cleanup, or DNS-after-LB-readback gating.

- [ ] **Step 2: Update verifier fixtures and implementation**

Require the exact new source files and invariants while preserving every current immutable image,
UID/GID, VPC binding, SSH `/32`, backend-before-ingress, and runbook phrase check.

- [ ] **Step 3: Update shell validation and runbook**

Document actual create-status evidence, journal recovery, certificate-only preflight, asynchronous
LB acknowledgement, independent cleanup, and one-final-run sequence. Add shell/static checks without
embedding a live hostname, resource ID, or credential.

- [ ] **Step 4: Add the focused CI test command**

Add after the existing DigitalOcean validation:

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts
```

- [ ] **Step 5: Run focused validation**

```bash
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
pnpm verify:digitalocean-browser-gateway
bash infra/digitalocean/browser-gateway/validate.sh
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml infra/digitalocean/browser-gateway/README.md \
  infra/digitalocean/browser-gateway/validate.sh \
  scripts/verify-digitalocean-browser-gateway.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
git commit -m "ci: gate asynchronous DigitalOcean resource recovery"
```

### Task 7: Full verification, focused PR, and merge

**Files:**

- Review every file changed from `origin/main`.

**Interfaces:**

- Produces one focused green PR titled
  `fix: reconcile asynchronous DigitalOcean resource creation`.

- [ ] **Step 1: Run repository checks**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
pnpm verify:digitalocean-browser-gateway
bash infra/digitalocean/browser-gateway/validate.sh
git diff --check origin/main...HEAD
```

Expected: every command passes.

- [ ] **Step 2: Scan the exact diff for secrets and scope**

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  infra/digitalocean/browser-gateway scripts/verify-digitalocean-browser-gateway.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts .github/workflows/ci.yml \
  docs/superpowers
```

Reject any API token, authorization value, private key, live hostname, live resource ID, product
behavior change, Gateway digest change, or unrelated file.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin codex/digitalocean-async-resource-reconcile
gh pr create --base main --head codex/digitalocean-async-resource-reconcile \
  --title "fix: reconcile asynchronous DigitalOcean resource creation" \
  --body-file release-evidence/private/m13a-digitalocean-final-20260729-12/pr-body.md
```

- [ ] **Step 4: Wait for exact-head CI and merge**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
git fetch origin main
```

Verify the merged main commit contains the exact green PR head tree before any provider preflight.

### Task 8: Certificate-only preflight and final disposable acceptance

**Files:**

- Private only:
  `release-evidence/private/m13a-digitalocean-final-20260729-12/resource-journal.json` and
  sanitized evidence.

**Interfaces:**

- Consumes the merged journal and state-machine modules.
- Produces the 13 required final acceptance fields and a validated private bundle SHA-256.

- [ ] **Step 1: Prove the provider baseline**

Verify zero disposable DigitalOcean resources and credentials, create one unique token, child zone,
and three temporary Name.com NS records, then wait for parent authority plus child SOA.

- [ ] **Step 2: Run certificate-only preflight**

Record actual HTTP create status, acknowledgement class, immediate journal persistence, exact
name/type/DNS readback, final `verified` state, duplicate count one, and independent cleanup
discoverability.

Stop and clean up without a Droplet on any failure.

- [ ] **Step 3: Run the fresh private backend**

Create one tag, firewall, key, and Droplet through the journaled lifecycle. Run all existing
backend-local listener, route, WSS, payload, security-audit, and secret-log checks. Remove SSH
immediately.

- [ ] **Step 4: Create and verify managed ingress**

Create one LB through the repaired state machine, persist its ID before polling, verify exact
configuration/readiness, restrict firewall `18789` to that LB, then create the DNS A record.

- [ ] **Step 5: Run public WSS and manual Chrome gates**

Run TLS, route, pairing, Origin, subprotocol, ping/pong, stability, payload, and log checks before
manual pairing. Pair the official extension, share only `https://example.com/`, take one minimized
read-only snapshot, unshare, require `no_shared_tab`, and revoke pairing.

- [ ] **Step 6: Validate evidence and finish**

On success, revoke browser access and ask whether to retain the working Gateway briefly or destroy
it. On failure, delete every provider, DNS, browser, local credential, and Keychain resource and
prove zero billable disposable resources. Do not authorize Milestone 13B unless the complete result
is `passed_13a`.
