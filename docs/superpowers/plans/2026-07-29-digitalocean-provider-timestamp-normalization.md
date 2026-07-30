# DigitalOcean Provider Timestamp Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canonicalize valid DigitalOcean RFC3339 resource timestamps before certificate or Load
Balancer identities enter the strict durable journal.

**Architecture:** Add one exported timestamp normalizer to the DigitalOcean API boundary. Reuse it
from typed certificate/Load Balancer readback parsers and the asynchronous create-acknowledgement
identity parsers so every provider path emits canonical UTC millisecond strings.

**Tech Stack:** TypeScript, Node.js `Date`, Vitest, pnpm.

## Global Constraints

- Keep the resource journal's canonical `Date.toISOString()` invariant unchanged.
- Cover certificate and Load Balancer create acknowledgement plus provider readback paths.
- Reject malformed, timezone-free, whitespace-padded, and impossible calendar timestamps.
- Preserve the missing-`created_at` local canonical-time fallback.
- Do not expose provider bodies, credentials, resource IDs, or authorization headers in errors.
- Do not modify the Gateway image, OpenClaw, UID/GID, bootstrap, routes, pairing, Origin policy,
  cleanup order, timeouts, landing page, or Milestone 13B.
- Create no live infrastructure during this repair.

---

### Task 1: Canonical DigitalOcean timestamp boundary

**Files:**

- Modify: `infra/digitalocean/browser-gateway/digitalocean-api.ts`
- Test: `infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts`

**Interfaces:**

- Produces:

```ts
export function normalizeDigitalOceanInstant(value: unknown, errorCode: string): string;
```

- `parseCertificate` and `parseLoadBalancer` consume the helper and continue to produce
  `createdAtUtc: string`.

- [ ] **Step 1: Add failing table-driven normalizer tests**

Import `normalizeDigitalOceanInstant` and add:

```ts
it.each([
  ["2026-07-29T23:38:23Z", "2026-07-29T23:38:23.000Z"],
  ["2026-07-29T23:38:23.125Z", "2026-07-29T23:38:23.125Z"],
  ["2026-07-29T19:38:23-04:00", "2026-07-29T23:38:23.000Z"]
])("normalizes DigitalOcean instant %s", (input, expected) => {
  expect(normalizeDigitalOceanInstant(input, "certificate_response_rejected")).toBe(expected);
});

it.each([
  "2026-02-30T12:00:00Z",
  "2026-07-29 23:38:23",
  "2026-07-29T23:38:23",
  " 2026-07-29T23:38:23Z",
  "not-a-date"
])("rejects invalid DigitalOcean instant %s", (input) => {
  expect(() => normalizeDigitalOceanInstant(input, "certificate_response_rejected")).toThrow(
    "certificate_response_rejected"
  );
});

it("rejects a non-string DigitalOcean instant", () => {
  expect(() => normalizeDigitalOceanInstant(12, "load_balancer_response_rejected")).toThrow(
    "load_balancer_response_rejected"
  );
});
```

- [ ] **Step 2: Run the timestamp tests and verify failure**

Run:

```sh
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
```

Expected: FAIL because `normalizeDigitalOceanInstant` is not exported.

- [ ] **Step 3: Implement the strict normalizer**

Add a closed RFC3339 matcher and calendar validation beside the existing API response parsers:

```ts
const DIGITALOCEAN_RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return leapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function normalizeDigitalOceanInstant(value: unknown, errorCode: string): string {
  if (typeof value !== "string") throw new Error(errorCode);
  const match = DIGITALOCEAN_RFC3339.exec(value);
  if (match === null) throw new Error(errorCode);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw new Error(errorCode);
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(errorCode);
  return new Date(timestamp).toISOString();
}
```

- [ ] **Step 4: Apply the helper to typed provider readback**

Change both resource parsers:

```ts
createdAtUtc: normalizeDigitalOceanInstant(
  certificate.created_at,
  "certificate_response_rejected"
)
```

and:

```ts
createdAtUtc: normalizeDigitalOceanInstant(
  loadBalancer.created_at,
  "load_balancer_response_rejected"
)
```

- [ ] **Step 5: Add readback regression tests using the real provider shape**

Mock one certificate list response and one Load Balancer list response with:

```ts
created_at: "2026-07-29T23:38:23Z"
```

Assert:

```ts
expect(certificate.createdAtUtc).toBe("2026-07-29T23:38:23.000Z");
expect(loadBalancer.createdAtUtc).toBe("2026-07-29T23:38:23.000Z");
```

Use a complete Load Balancer response containing the exact `REGIONAL`, `EXTERNAL`, `IPV4`,
HTTPS-443-to-HTTP-18789 forwarding rule, TCP-18789 health check, one Droplet, no redirect, and no
PROXY protocol fields required by `parseLoadBalancer`.

- [ ] **Step 6: Run API boundary tests**

Run:

```sh
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the boundary and tests**

```sh
git add \
  infra/digitalocean/browser-gateway/digitalocean-api.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts
git commit -m "fix: normalize DigitalOcean provider timestamps"
```

### Task 2: Asynchronous create acknowledgement normalization

**Files:**

- Modify: `infra/digitalocean/browser-gateway/managed-certificate.ts`
- Test: `infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts`
- Modify: `infra/digitalocean/browser-gateway/managed-load-balancer.ts`
- Test: `infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts`

**Interfaces:**

- Consumes:

```ts
normalizeDigitalOceanInstant(value: unknown, errorCode: string): string
```

- Preserves `returnedIdentity(...): { id; status; createdAtUtc } | null`.

- [ ] **Step 1: Add failing certificate acknowledgement regression**

Add a test whose create observation contains raw provider fields:

```ts
certificate: {
  id: ID,
  state: "pending",
  created_at: "2026-07-29T16:05:00Z"
}
```

Use pending then verified readback doubles. Assert:

```ts
expect(journal.entries[0]?.createdAtUtc).toBe("2026-07-29T16:05:00.000Z");
expect(events.indexOf("journal_created")).toBeLessThan(events.indexOf("get"));
```

- [ ] **Step 2: Add failing Load Balancer acknowledgement regression**

Add a test whose create observation contains:

```ts
load_balancer: {
  id: ID,
  status: "new",
  created_at: "2026-07-29T16:06:00Z"
}
```

Use new then active readback doubles. Assert:

```ts
expect(journal.entries[0]?.createdAtUtc).toBe("2026-07-29T16:06:00.000Z");
expect(events.indexOf("journal_created")).toBeLessThan(events.indexOf("get:new"));
```

- [ ] **Step 3: Run the state-machine tests and verify failure**

Run:

```sh
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts
```

Expected: FAIL because the returned identities still contain whole-second provider timestamps.

- [ ] **Step 4: Normalize certificate returned identity**

Import the helper as a value and preserve the type imports:

```ts
import {
  DigitalOceanTransportError,
  normalizeDigitalOceanInstant
} from "./digitalocean-api.ts";
```

Change the returned identity:

```ts
createdAtUtc:
  certificate.created_at === undefined
    ? null
    : normalizeDigitalOceanInstant(
        certificate.created_at,
        "certificate_response_rejected"
      )
```

This keeps missing timestamps on the existing canonical local-time fallback and rejects present
malformed timestamps.

- [ ] **Step 5: Normalize Load Balancer returned identity**

Import the same helper and change the returned identity:

```ts
createdAtUtc:
  loadBalancer.created_at === undefined
    ? null
    : normalizeDigitalOceanInstant(
        loadBalancer.created_at,
        "load_balancer_response_rejected"
      )
```

- [ ] **Step 6: Add malformed acknowledgement tests**

For each state machine, provide `created_at: "2026-02-30T12:00:00Z"` with an otherwise valid ID and
assert the exact resource-specific response error. Assert `journal.entries` remains empty and the
readback mock is not called.

- [ ] **Step 7: Run the focused state-machine tests**

Run:

```sh
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the state-machine repair**

```sh
git add \
  infra/digitalocean/browser-gateway/managed-certificate.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts
git commit -m "test: cover asynchronous timestamp persistence"
```

### Task 3: Full verification and policy review

**Files:**

- Verify: `infra/digitalocean/browser-gateway/validate.sh`
- Verify: `scripts/verify-digitalocean-browser-gateway.ts`
- Verify: repository formatting, lint, typecheck, and unit projects

**Interfaces:**

- Consumes the completed boundary and state-machine repair.
- Produces a clean, reviewable branch with no live infrastructure side effects.

- [ ] **Step 1: Run the complete focused DigitalOcean suite**

```sh
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/config.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  infra/digitalocean/browser-gateway/resource-journal.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-certificate.unit.test.ts \
  infra/digitalocean/browser-gateway/managed-load-balancer.unit.test.ts \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the infrastructure validators**

```sh
pnpm verify:digitalocean-browser-gateway
bash infra/digitalocean/browser-gateway/validate.sh
```

Expected: both commands PASS without Docker-required live mutation.

- [ ] **Step 3: Run repository quality gates**

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
```

Expected: all commands PASS.

- [ ] **Step 4: Review for secrets and scope regressions**

```sh
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  infra/digitalocean/browser-gateway \
  docs/superpowers
git grep -n -E 'dop_v1_|BEGIN (OPENSSH|RSA|EC) PRIVATE KEY' \
  -- ':!release-evidence/private'
git status --short --branch
```

Expected:

- no whitespace error;
- changes limited to the approved spec, plan, DigitalOcean timestamp boundary, state machines, and
  their tests;
- no token or private key material;
- immutable Gateway digest and product behavior unchanged; and
- no untracked private evidence.

- [ ] **Step 5: Record final commit if verification formatting changed files**

If a formatter makes a tracked change:

```sh
git add \
  infra/digitalocean/browser-gateway \
  docs/superpowers/plans/2026-07-29-digitalocean-provider-timestamp-normalization.md
git commit -m "chore: finalize DigitalOcean timestamp repair"
```

If formatting changes nothing, do not create an empty commit.
