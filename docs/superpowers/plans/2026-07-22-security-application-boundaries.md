# Security and Application Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Vera's application-layer release blockers by auditing the current system, enforcing founder-only browser execution, bounding every mutation payload, proving Gmail remains read-only, and redacting nested secrets from logs.

**Architecture:** Preserve the existing authenticated-session, tenant-repository, policy, dispatch, and worker boundaries. Add one pure domain authorization decision for the founder browser allowlist, one shared web mutation parser, one static Gmail capability verifier, and one recursive log sanitizer; enforce each control at every independently reachable layer so a route or worker cannot bypass it.

**Tech Stack:** TypeScript 6, Zod 4, Next.js 16 route handlers, Vitest 4, Pino 10, pnpm 11, PostgreSQL-backed integration tests.

## Global Constraints

- Release scope is exactly one founder, one Maritime-hosted OpenClaw gateway, one explicitly paired founder-owned node, and one dedicated manually authenticated browser profile.
- `VERA_BROWSER_FOUNDER_USER_IDS` is a server-only comma-separated list of exact Vera UUIDs; missing or malformed configuration denies browser work.
- Gmail production capability is `gmail.readonly` only. No `gmail.compose`, `gmail.modify`, `mail.google.com`, `drafts.create`, `drafts.send`, or `messages.send` path may exist.
- Authenticate the Vera session and validate the exact configured origin before reading a mutation body.
- JSON request limits are measured in UTF-8 bytes while streaming; `Content-Length` is an optimization, never the only limit.
- Never log passwords, cookies, authorization codes or headers, API keys, access/refresh tokens, email addresses, phone numbers, raw listing evidence, prompts, snapshots, or response bodies.
- Treat all connector, provider, and browser output as untrusted and schema-validate it before persistence.
- Preserve every current fail-closed source policy, approval, tenant, payload-hash, replay, and kill-switch check.
- Do not broaden the MVP, add a connector, add Gmail compose/send, or add marketplace login automation.

---

## File Map

- Create `docs/SECURITY_REVIEW.md`: evidence-first threat model and finding register written before application code changes.
- Create `packages/domain/src/founder-browser-access.ts`: pure parsing and authorization decision for the founder browser allowlist.
- Modify `packages/domain/src/index.ts`: export the founder browser access contract.
- Create `packages/domain/src/founder-browser-access.unit.test.ts`: missing, malformed, denied, and allowed cases.
- Modify `apps/web/lib/browser-agent-service.ts`: deny job creation before any repository mutation when the user is not allowlisted.
- Create `apps/web/lib/browser-agent-service.unit.test.ts`: service-layer founder allowlist and no-mutation regression tests.
- Modify `apps/web/lib/server/maritime-dispatch.ts`: recheck the founder allowlist before creating a Maritime dispatch.
- Create `apps/web/lib/server/maritime-dispatch.unit.test.ts`: dispatch-layer founder allowlist and no-wake regression tests.
- Modify `apps/worker/src/acquisition-worker.ts`: recheck the founder allowlist before invoking OpenClaw.
- Modify `apps/worker/src/postgres-runtime.ts`: pass the exact server-only allowlist into acquisition execution.
- Modify `apps/web/lib/server/request-security.ts`: bounded JSON parsing and typed request errors.
- Modify `apps/web/lib/server/request-security.unit.test.ts`: byte limits, content type, malformed JSON, cancellation, and origin behavior.
- Modify `apps/web/lib/server/auth-config.ts`: explicit production cookie, session, and single-instance rate-limit policy.
- Modify `apps/web/lib/server/auth-config.unit.test.ts`: identity-only scopes, cookies, sessions, CSRF/origin, linking, and rate-limit regression tests.
- Modify `apps/web/lib/server/session.unit.test.ts`: expired/revoked/session-owner regression tests.
- Modify `apps/web/lib/server/google-integration-oauth.unit.test.ts` and `apps/web/lib/server/gmail-integration-oauth.unit.test.ts`: wrong-user, expired/replayed state, partial consent, revoked grant, and secret-free logging regression tests.
- Modify every body-reading route under `apps/web/app/api/**/route.ts`: session, origin, bounded body, schema parsing in that order.
- Create `scripts/verify-web-mutation-boundaries.ts`: regression check for mutation ordering and unbounded body APIs.
- Create `scripts/verify-web-mutation-boundaries.unit.test.ts`: verifier fixtures.
- Create `scripts/verify-gmail-boundaries.ts`: production-source capability scan.
- Create `scripts/verify-gmail-boundaries.unit.test.ts`: forbidden scope/method/endpoint fixtures and allowed read-only fixtures.
- Modify `packages/connectors/src/gmail-client.ts`: bounded request deadline and caller cancellation for Gmail API requests.
- Modify `packages/connectors/src/gmail-client.unit.test.ts`: timeout, cancellation, and response-size tests.
- Modify `apps/worker/src/google-gmail-access.ts`: bounded token-refresh deadline per attempt.
- Create `apps/worker/src/google-gmail-access.unit.test.ts`: timeout and bounded retry tests.
- Create `apps/worker/src/log-sanitizer.ts`: recursive key and value redaction with depth/entry limits.
- Create `apps/worker/src/log-sanitizer.unit.test.ts`: nested objects, arrays, contact patterns, cycles, and harmless metadata.
- Modify `apps/worker/src/logger.ts`: apply the sanitizer to all structured log bindings.
- Modify `package.json` and `.github/workflows/ci.yml`: add both boundary verifiers to local and CI acceptance gates.
- Modify `.env.example`, `docs/SECURITY.md`, and `infra/maritime/ENVIRONMENT.md`: document the founder allowlist and closed Gmail boundary.

### Task 1: Publish the Pre-Code Security Review

**Files:**
- Create: `docs/SECURITY_REVIEW.md`
- Reference: `docs/superpowers/specs/2026-07-22-production-security-beta-hardening-design.md`
- Reference: `packages/db/drizzle/0003_maritime_execution_plane.sql`
- Reference: `apps/web/lib/browser-agent-service.ts`
- Reference: `apps/web/lib/server/maritime-dispatch.ts`
- Reference: `apps/worker/src/acquisition-worker.ts`
- Reference: `infra/maritime/*`

**Interfaces:**
- Consumes: the approved hardening design and current repository evidence.
- Produces: finding IDs `SEC-001` through `SEC-012`, each with a fixed severity, evidence path, exploit path, remediation, owner, release-blocker flag, and status.

- [ ] **Step 1: Write the finding register before changing code**

Use this exact table shape and initial findings; add only evidence-backed rows discovered during the final audit:

```markdown
| ID | Boundary / threat | Severity | Evidence | Exploit or failure path | Required fix | Owner | Release blocker | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | Non-founder browser execution | High | `apps/web/lib/browser-agent-service.ts`; `apps/web/lib/server/maritime-dispatch.ts`; `apps/worker/src/acquisition-worker.ts` | Any authenticated user can reach the experimental founder gateway when the normal browser controls are enabled. | Enforce one server-side founder UUID allowlist at job creation, dispatch, and worker execution. | Application | Yes | Open |
| SEC-002 | OpenClaw capability surface | High | `infra/maritime/OPENCLAW.md`; no checked-in enforced gateway config | Documentation denies dangerous commands, but deployment does not enforce the command, tool, plugin, channel, and browser-profile allowlists. | Add and schema-validate a least-privilege `2026.6.33` gateway configuration. | Infrastructure | Yes | Open |
| SEC-003 | Mutable release identity | High | `Dockerfile`; `infra/maritime/README.md` | Tag-only worker and OpenClaw deploys can resolve to different bytes and have no recorded SBOM/provenance. | Pin immutable digests and require provenance/SBOM evidence in release validation. | Release | Yes | Open |
| SEC-004 | Public worker ingress | Medium | `infra/maritime/README.md` uses `--public` | An unnecessary public surface increases scanning and denial-of-service exposure. | Remove public worker ingress and keep health/readiness agent-local. | Infrastructure | Yes | Open |
| SEC-005 | Mutation request exhaustion and CSRF inconsistency | Medium | `apps/web/app/api/captures/route.ts` reads before auth; several routes omit origin checks or call unbounded `request.json()` | An attacker can force unauthenticated body buffering or cross-origin authenticated mutations. | Authenticate, check exact origin, then stream a bounded JSON body in every mutation route. | Web | Yes | Open |
| SEC-006 | Gmail capability regression | High | Current implementation is read-only; no dedicated static acceptance gate | A later route or SDK call can silently add compose/send/modify behavior. | Add a production-source verifier and CI gate that rejects every compose/send/modify scope and method. | Integrations | Yes | Open |
| SEC-007 | Nested log disclosure | Medium | `apps/worker/src/logger.ts` redacts only shallow paths | Secrets or contact data nested in arrays or provider objects can enter logs. | Recursively sanitize keys and contact-shaped strings before Pino serialization. | Worker | Yes | Open |
| SEC-008 | Outbound request hangs | Medium | Gmail list/detail and token refresh do not impose their own complete deadline | A provider stall can hold a worker lane and lease until external termination. | Compose caller cancellation with a bounded per-attempt timeout and typed safe errors. | Integrations | Yes | Open |
| SEC-009 | PostgreSQL schedule uniqueness and ciphertext bounds | Medium | Migration `0003` allows duplicate null-source schedules and unbounded encrypted Web Push fields | Duplicate scheduler rows can duplicate work; oversized encrypted fields can amplify storage abuse. | Add migration preflight, partial uniqueness, and exact nonce/tag plus bounded ciphertext checks. | Persistence | Yes | Open |
| SEC-010 | Ephemeral record retention | Medium | Expiring OAuth state, dispatch, lease, and heartbeat rows exist without implemented cleanup | Expired control data accumulates and complicates incident response. | Add bounded cleanup that preserves raw listings and append-only audit history. | Reliability | No for founder staging; Yes for broader beta | Open |
| SEC-011 | Browser data-flow ambiguity | Medium | Current docs state the local boundary but do not enumerate every transit/persistence/log boundary | Operators can incorrectly claim page content never leaves the founder device. | Publish an exact data inventory and retention statement. | Privacy | Yes | Open |
| SEC-012 | Missing unified live staging evidence | High | Opt-in tests are separate and no signed release evidence exists | Local mocks can pass while Maritime, gateway, node, policy, or rollback is broken. | Add and run one staged positive/failure matrix against immutable release identities. | Release | Yes | Open |
```

Include separate sections for protected assets, trust boundaries, threat actors, browser gateway threats, OAuth/Gmail threats, PostgreSQL threats, provider outages, dependency/supply-chain threats, and incident containment. State the initial outcome as **conditional founder staging** and explicitly state **not approved for multi-user beta**.

- [ ] **Step 2: Verify the document contains every mandatory field and no unsupported claim**

Run:

```bash
rg -n "SEC-00[1-9]|SEC-01[0-2]|conditional founder staging|not approved for multi-user beta|Severity|Evidence|Exploit|Required fix|Owner|Release blocker" docs/SECURITY_REVIEW.md
```

Expected: all twelve finding IDs, both release statements, and every table column are present.

- [ ] **Step 3: Commit the audit independently**

```bash
git add docs/SECURITY_REVIEW.md
git commit -m "docs: audit founder release security boundaries"
```

Expected: one commit containing only the pre-code audit.

### Task 2: Enforce the Founder Browser Allowlist at Three Boundaries

**Files:**
- Create: `packages/domain/src/founder-browser-access.ts`
- Create: `packages/domain/src/founder-browser-access.unit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/web/lib/browser-agent-service.ts`
- Create: `apps/web/lib/browser-agent-service.unit.test.ts`
- Modify: `apps/web/lib/server/maritime-dispatch.ts`
- Create: `apps/web/lib/server/maritime-dispatch.unit.test.ts`
- Modify: `apps/worker/src/acquisition-worker.ts`
- Modify: `apps/worker/src/acquisition-worker.unit.test.ts`
- Modify: `apps/worker/src/postgres-runtime.ts`

**Interfaces:**
- Consumes: `VeraUserIdSchema`, authenticated `VeraUserId`, and raw server environment value.
- Produces: `evaluateFounderBrowserAccess(userId, configuredUserIds)` and `FounderBrowserAuthorizationError` with safe denial codes.

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateFounderBrowserAccess, FounderBrowserAuthorizationError, requireFounderBrowserAccess } from "./founder-browser-access.ts";

const founder = "018f9f64-7b5a-7c91-a12e-123456789abc";
const other = "118f9f64-7b5a-7c91-a12e-123456789abc";

describe("founder browser access", () => {
  it("fails closed when the list is absent, malformed, or does not include the user", () => {
    expect(evaluateFounderBrowserAccess(founder, undefined)).toEqual({ allowed: false, code: "founder_browser_allowlist_missing" });
    expect(evaluateFounderBrowserAccess(founder, "not-a-uuid")).toEqual({ allowed: false, code: "founder_browser_allowlist_invalid" });
    expect(evaluateFounderBrowserAccess(founder, other)).toEqual({ allowed: false, code: "founder_browser_user_denied" });
  });

  it("allows only an exact configured Vera UUID", () => {
    expect(evaluateFounderBrowserAccess(founder, ` ${other},${founder} `)).toEqual({ allowed: true, userId: founder });
    expect(() => requireFounderBrowserAccess(other, founder)).toThrow(FounderBrowserAuthorizationError);
  });
});
```

- [ ] **Step 2: Run the domain test and confirm the missing module failure**

Run: `pnpm exec vitest run --project unit packages/domain/src/founder-browser-access.unit.test.ts`

Expected: FAIL because `founder-browser-access.ts` does not exist.

- [ ] **Step 3: Implement the pure decision and export it**

```ts
import { VeraUserIdSchema, type VeraUserId } from "./primitives.ts";

export type FounderBrowserAccessDenialCode =
  | "founder_browser_allowlist_missing"
  | "founder_browser_allowlist_invalid"
  | "founder_browser_user_denied";

export type FounderBrowserAccessDecision =
  | { readonly allowed: true; readonly userId: VeraUserId }
  | { readonly allowed: false; readonly code: FounderBrowserAccessDenialCode };

export class FounderBrowserAuthorizationError extends Error {
  constructor(readonly code: FounderBrowserAccessDenialCode) {
    super(code);
    this.name = "FounderBrowserAuthorizationError";
  }
}

export function evaluateFounderBrowserAccess(
  userId: VeraUserId,
  configuredUserIds: string | undefined
): FounderBrowserAccessDecision {
  const configured = configuredUserIds?.trim();
  if (!configured) return { allowed: false, code: "founder_browser_allowlist_missing" };
  const parsed = configured.split(",").map((value) => VeraUserIdSchema.safeParse(value.trim()));
  if (parsed.some((entry) => !entry.success)) {
    return { allowed: false, code: "founder_browser_allowlist_invalid" };
  }
  const allowed = parsed.map((entry) => entry.success && entry.data).includes(userId);
  return allowed ? { allowed: true, userId } : { allowed: false, code: "founder_browser_user_denied" };
}

export function requireFounderBrowserAccess(userId: VeraUserId, configuredUserIds: string | undefined): void {
  const decision = evaluateFounderBrowserAccess(userId, configuredUserIds);
  if (!decision.allowed) throw new FounderBrowserAuthorizationError(decision.code);
}
```

Add `export * from "./founder-browser-access.ts";` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Enforce the decision before each side effect**

Add `founderBrowserUserIds?: string` to the browser service, dispatch, and acquisition dependency inputs. Call this exact statement before repository insertion, dispatch creation, or provider invocation for any `local_browser` job:

```ts
requireFounderBrowserAccess(dependencies.userId, dependencies.founderBrowserUserIds);
```

Pass `process.env.VERA_BROWSER_FOUNDER_USER_IDS` from the web route and worker composition root. In `dispatchHostedSourceJob`, use the existing `environment` dependency rather than reading globals in tests:

```ts
if (job.acquisitionMode === "local_browser") {
  requireFounderBrowserAccess(input.userId, environment.VERA_BROWSER_FOUNDER_USER_IDS);
}
```

- [ ] **Step 5: Add boundary tests that prove no lower layer is reached**

Each layer test must use the non-founder UUID and assert the next side effect was untouched:

```ts
await expect(createCurrentTabCaptureJob({ ...dependencies, founderBrowserUserIds: founder }, request)).rejects.toMatchObject({
  code: "founder_browser_user_denied"
});
expect(dependencies.repositoryProvider.transaction).not.toHaveBeenCalled();

await expect(dispatchHostedSourceJob({ ...dependencies, environment: { VERA_BROWSER_FOUNDER_USER_IDS: founder } }, job.id)).rejects.toMatchObject({
  code: "founder_browser_user_denied"
});
expect(maritimeClient.wake).not.toHaveBeenCalled();

await expect(processNextAcquisitionJob({ ...dependencies, founderBrowserUserIds: founder })).rejects.toMatchObject({
  code: "founder_browser_user_denied"
});
expect(browserProvider.capture).not.toHaveBeenCalled();
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm exec vitest run --project unit \
  packages/domain/src/founder-browser-access.unit.test.ts \
  apps/web/lib/browser-agent-service.unit.test.ts \
  apps/web/lib/server/maritime-dispatch.unit.test.ts \
  apps/worker/src/acquisition-worker.unit.test.ts
```

Expected: PASS; the denied cases create no job, dispatch, provider call, raw listing, or cursor advancement.

- [ ] **Step 7: Commit the founder boundary**

```bash
git add packages/domain/src/founder-browser-access.ts packages/domain/src/founder-browser-access.unit.test.ts packages/domain/src/index.ts apps/web/lib/browser-agent-service.ts apps/web/lib/browser-agent-service.unit.test.ts apps/web/lib/server/maritime-dispatch.ts apps/web/lib/server/maritime-dispatch.unit.test.ts apps/worker/src/acquisition-worker.ts apps/worker/src/acquisition-worker.unit.test.ts apps/worker/src/postgres-runtime.ts
git commit -m "fix: restrict browser execution to founder"
```

### Task 3: Make Hosted Identity and OAuth Security Explicit

**Files:**
- Modify: `apps/web/lib/server/auth-config.ts`
- Modify: `apps/web/lib/server/auth-config.unit.test.ts`
- Modify: `apps/web/lib/server/session.unit.test.ts`
- Modify: `apps/web/lib/server/google-integration-oauth.unit.test.ts`
- Modify: `apps/web/lib/server/gmail-integration-oauth.unit.test.ts`
- Modify: `docs/SECURITY_REVIEW.md`

**Interfaces:**
- Consumes: Better Auth `1.6.23`, one hosted web instance, exact public origin, and the separate Google identity/integration clients.
- Produces: explicit seven-day server sessions, secure Lax cookies, database-backed identity state, single-instance rate limits, and regression evidence for integration OAuth state/PKCE/scope handling.

- [ ] **Step 1: Write failing explicit-policy assertions**

```ts
it("uses explicit founder-release session, cookie, and rate-limit policy", () => {
  const options = buildIdentityAuthOptions(parseIdentityAuthEnvironment(environment));
  expect(options.session).toEqual({
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false }
  });
  expect(options.advanced.defaultCookieAttributes).toEqual({
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/"
  });
  expect(options.advanced.disableCSRFCheck).toBe(false);
  expect(options.advanced.disableOriginCheck).toBe(false);
  expect(options.rateLimit).toMatchObject({ enabled: true, storage: "memory", window: 60, max: 60 });
  expect(options.rateLimit.customRules["/sign-in/social"]).toEqual({ window: 60, max: 10 });
  expect(options.rateLimit.customRules["/callback/google"]).toEqual({ window: 60, max: 20 });
});
```

Keep the existing identity-only scope and account-linking assertions.

- [ ] **Step 2: Run and confirm the missing explicit settings**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/auth-config.unit.test.ts`

Expected: FAIL because `session`, `defaultCookieAttributes`, and explicit `rateLimit` are absent.

- [ ] **Step 3: Add the exact Better Auth policy**

```ts
session: {
  expiresIn: 60 * 60 * 24 * 7,
  updateAge: 60 * 60 * 24,
  cookieCache: { enabled: false }
},
rateLimit: {
  enabled: true,
  storage: "memory",
  window: 60,
  max: 60,
  customRules: {
    "/sign-in/social": { window: 60, max: 10 },
    "/callback/google": { window: 60, max: 20 }
  }
},
advanced: {
  database: { generateId: "uuid" },
  useSecureCookies: environment.NODE_ENV === "production",
  disableCSRFCheck: false,
  disableOriginCheck: false,
  crossSubDomainCookies: { enabled: false },
  defaultCookieAttributes: {
    httpOnly: true,
    sameSite: "lax",
    secure: environment.NODE_ENV === "production",
    path: "/"
  },
  cookiePrefix: "vera"
}
```

Memory storage is intentional only because the founder topology has exactly one web instance; horizontal scaling remains out of scope and would require a shared atomic limiter.

- [ ] **Step 4: Re-run the complete auth/OAuth regression matrix**

Add or retain tests proving:

```ts
await expect(requireVeraSession(headers, appWithSession(null))).rejects.toThrow(AuthenticationRequiredError);
await expect(calendarOAuth.handleCallback({ userId: otherUser, state, code })).rejects.toMatchObject({ code: "invalid_state" });
await expect(gmailOAuth.handleCallback({ userId, state: expiredState, code })).rejects.toMatchObject({ code: "invalid_state" });
await expect(gmailOAuth.handleCallback({ userId, state, code })).resolves.toMatchObject({ grantedScopes: [GMAIL_READONLY_SCOPE] });
await expect(gmailOAuth.handleCallback({ userId, state, code })).rejects.toMatchObject({ code: "invalid_state" });
expect(JSON.stringify(testLogger.entries)).not.toMatch(/authorization-code|refresh-token|client-secret/iu);
```

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/auth-config.unit.test.ts \
  apps/web/lib/server/session.unit.test.ts \
  apps/web/lib/server/google-integration-oauth.unit.test.ts \
  apps/web/lib/server/gmail-integration-oauth.unit.test.ts
```

Expected: PASS; identity requests only `openid email profile`, Gmail requests only `gmail.readonly`, state is single-use/user-bound/expiring, Calendar PKCE material remains encrypted, and no secret reaches logs.

- [ ] **Step 5: Update the audit and commit**

Record Better Auth's single-instance memory limiter as an accepted founder-only constraint and a horizontal-scaling blocker, not a multi-user control.

```bash
git add apps/web/lib/server/auth-config.ts apps/web/lib/server/auth-config.unit.test.ts apps/web/lib/server/session.unit.test.ts apps/web/lib/server/google-integration-oauth.unit.test.ts apps/web/lib/server/gmail-integration-oauth.unit.test.ts docs/SECURITY_REVIEW.md
git commit -m "fix: make hosted auth policy explicit"
```

### Task 4: Bound and Authenticate Every Web Mutation

**Files:**
- Modify: `apps/web/lib/server/request-security.ts`
- Modify: `apps/web/lib/server/request-security.unit.test.ts`
- Modify: every body-reading `apps/web/app/api/**/route.ts`
- Create: `scripts/verify-web-mutation-boundaries.ts`
- Create: `scripts/verify-web-mutation-boundaries.unit.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: a WHATWG `Request`, exact origin configuration, and per-route maximum byte count.
- Produces: `readBoundedJson(request, { maxBytes })`, `MutationRequestError`, and verifier `findMutationBoundaryViolations(files)`.

- [ ] **Step 1: Write failing parser tests**

```ts
it("rejects before buffering a body beyond the byte limit", async () => {
  const request = new Request("https://vera.example.test/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "9" },
    body: JSON.stringify({ a: "é" })
  });
  await expect(readBoundedJson(request, { maxBytes: 8 })).rejects.toMatchObject({ code: "payload_too_large", status: 413 });
});

it.each(["text/plain", "application/x-www-form-urlencoded"])("rejects %s", async (contentType) => {
  const request = new Request("https://vera.example.test/api/test", { method: "POST", headers: { "content-type": contentType }, body: "{}" });
  await expect(readBoundedJson(request, { maxBytes: 64 })).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });
});

it("rejects malformed JSON with a safe code", async () => {
  const request = new Request("https://vera.example.test/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  await expect(readBoundedJson(request, { maxBytes: 64 })).rejects.toMatchObject({ code: "malformed_json", status: 400 });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm exec vitest run --project unit apps/web/lib/server/request-security.unit.test.ts`

Expected: FAIL because `readBoundedJson` and `MutationRequestError` do not exist.

- [ ] **Step 3: Implement the bounded parser**

```ts
export type MutationRequestErrorCode = "unsupported_media_type" | "payload_too_large" | "malformed_json";

export class MutationRequestError extends Error {
  constructor(readonly code: MutationRequestErrorCode, readonly status: 400 | 413 | 415) {
    super(code);
    this.name = "MutationRequestError";
  }
}

export async function readBoundedJson(
  request: Request,
  options: { readonly maxBytes: number }
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new MutationRequestError("unsupported_media_type", 415);
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > options.maxBytes)) {
    throw new MutationRequestError("payload_too_large", 413);
  }
  if (request.body === null) throw new MutationRequestError("malformed_json", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    bytes += item.value.byteLength;
    if (bytes > options.maxBytes) {
      await reader.cancel("payload_too_large");
      throw new MutationRequestError("payload_too_large", 413);
    }
    chunks.push(item.value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
  } catch {
    throw new MutationRequestError("malformed_json", 400);
  }
}
```

- [ ] **Step 4: Convert every mutation route to the same ordering**

For routes with a body, use this exact order and route-specific limits (`260_000` bytes only for direct user capture, `32_768` for browser capture, and `16_384` for all other JSON mutations):

```ts
const context = await requireVeraSession(request.headers, getHostedApplication());
assertSameOriginMutation(request);
const input = RequestSchema.parse(await readBoundedJson(request, { maxBytes: 16_384 }));
```

For bodyless POST/DELETE routes, require the session and exact origin before any repository/provider call. Remove every direct `request.json()` and `request.text()` from route files after conversion.

- [ ] **Step 5: Add a static regression verifier**

Implement and export:

```ts
export interface MutationBoundaryViolation { readonly file: string; readonly message: string }

export function findMutationBoundaryViolations(files: ReadonlyMap<string, string>): readonly MutationBoundaryViolation[] {
  const violations: MutationBoundaryViolation[] = [];
  for (const [file, source] of files) {
    if (!/export async function (?:POST|PUT|PATCH|DELETE)\b/u.test(source)) continue;
    if (!/requireVeraSession\(/u.test(source)) violations.push({ file, message: "mutation route must authenticate" });
    if (!/assertSameOriginMutation\(/u.test(source)) violations.push({ file, message: "mutation route must check exact origin" });
    if (/request\.(?:json|text)\(/u.test(source)) violations.push({ file, message: "mutation route must use readBoundedJson" });
  }
  return violations;
}
```

The CLI must read tracked route files under `apps/web/app/api`, exclude OAuth `GET` callbacks, print one safe line per violation, and exit nonzero.

- [ ] **Step 6: Run parser, route, and verifier tests**

Run:

```bash
pnpm exec vitest run --project unit apps/web/lib/server/request-security.unit.test.ts scripts/verify-web-mutation-boundaries.unit.test.ts
pnpm verify:web-mutation-boundaries
```

Expected: PASS and `Web mutation boundaries validated.`; unauthenticated, wrong-origin, wrong-content-type, malformed, and oversized cases produce `401`, `403`, `415`, `400`, and `413` without repository mutation.

- [ ] **Step 7: Commit the mutation boundary**

```bash
git add apps/web/lib/server/request-security.ts apps/web/lib/server/request-security.unit.test.ts apps/web/app/api scripts/verify-web-mutation-boundaries.ts scripts/verify-web-mutation-boundaries.unit.test.ts package.json .github/workflows/ci.yml
git commit -m "fix: bound and authenticate web mutations"
```

### Task 5: Make Gmail Read-Only a Static Acceptance Gate

**Files:**
- Create: `scripts/verify-gmail-boundaries.ts`
- Create: `scripts/verify-gmail-boundaries.unit.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/SECURITY.md`

**Interfaces:**
- Consumes: tracked production TypeScript sources under `apps/web`, `apps/worker`, and `packages/connectors`.
- Produces: `findGmailBoundaryViolations(files)` and root command `pnpm verify:gmail-boundaries`.

- [ ] **Step 1: Write failing verifier fixtures**

```ts
it.each([
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://mail.google.com/",
  "gmail.users.drafts.create",
  "gmail.users.drafts.send",
  "gmail.users.messages.send",
  "/gmail/v1/users/me/drafts/send"
])("rejects forbidden Gmail capability %s", (source) => {
  expect(findGmailBoundaryViolations(new Map([["production.ts", source]]))).toHaveLength(1);
});

it("allows the exact readonly scope and GET list/detail endpoints", () => {
  expect(findGmailBoundaryViolations(new Map([["production.ts", "https://www.googleapis.com/auth/gmail.readonly GET /gmail/v1/users/me/messages"]]))).toEqual([]);
});
```

- [ ] **Step 2: Run the verifier test and confirm it fails**

Run: `pnpm exec vitest run --project unit scripts/verify-gmail-boundaries.unit.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the production-source scan**

```ts
const forbidden = [
  /https:\/\/www\.googleapis\.com\/auth\/gmail\.(?:compose|modify|send)/iu,
  /https:\/\/mail\.google\.com\//iu,
  /\b(?:drafts|messages)\.(?:create|send)\b/iu,
  /\/gmail\/v1\/users\/[^/]+\/(?:drafts|messages)\/send\b/iu
] as const;

export function findGmailBoundaryViolations(files: ReadonlyMap<string, string>): readonly GmailBoundaryViolation[] {
  return [...files].flatMap(([file, source]) => forbidden.flatMap((pattern) => pattern.test(source) ? [{ file, pattern: pattern.source }] : []));
}
```

The CLI must exclude `*.test.ts`, `*.spec.ts`, sanitized fixtures, generated output, docs, and the verifier itself. It must also require the exact readonly scope in `packages/domain/src/google-integration.ts` and the `GET`-only client in `packages/connectors/src/gmail-client.ts`.

- [ ] **Step 4: Wire the verifier into local and CI gates**

Add:

```json
"verify:gmail-boundaries": "tsx scripts/verify-gmail-boundaries.ts"
```

Add a CI step before lint:

```yaml
- name: Verify Gmail read-only boundary
  run: pnpm verify:gmail-boundaries
```

- [ ] **Step 5: Run the verifier and unit suite**

Run:

```bash
pnpm exec vitest run --project unit scripts/verify-gmail-boundaries.unit.test.ts
pnpm verify:gmail-boundaries
```

Expected: PASS and `Gmail production sources are readonly-only.`

- [ ] **Step 6: Commit the no-send gate**

```bash
git add scripts/verify-gmail-boundaries.ts scripts/verify-gmail-boundaries.unit.test.ts package.json .github/workflows/ci.yml docs/SECURITY.md
git commit -m "test: enforce Gmail read-only capability"
```

### Task 6: Add Deadlines and Cancellation to Gmail Network Calls

**Files:**
- Modify: `packages/connectors/src/gmail-client.ts`
- Modify: `packages/connectors/src/gmail-client.unit.test.ts`
- Modify: `apps/worker/src/google-gmail-access.ts`
- Create: `apps/worker/src/google-gmail-access.unit.test.ts`

**Interfaces:**
- Consumes: caller `AbortSignal`, injected `fetch`, and configured timeout.
- Produces: composed cancellation with a default `10_000` ms request deadline and existing safe `GmailClientError` categories.

- [ ] **Step 1: Write fake-timer tests for timeout and caller cancellation**

```ts
it("times out a stalled Gmail request", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  const pending = new GoogleGmailClient("access-token", fetchImpl, { timeoutMilliseconds: 1_000 }).searchListingAlerts(query);
  await vi.advanceTimersByTimeAsync(1_001);
  await expect(pending).rejects.toMatchObject({ code: "gmail_timeout", retryable: true });
});

it("honors caller cancellation before the deadline", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("cancelled", "AbortError"));
  await expect(client.searchListingAlerts(query, controller.signal)).rejects.toMatchObject({ code: "gmail_cancelled", retryable: true });
});
```

- [ ] **Step 2: Run focused tests and confirm timeout cases fail**

Run: `pnpm exec vitest run --project unit packages/connectors/src/gmail-client.unit.test.ts apps/worker/src/google-gmail-access.unit.test.ts`

Expected: FAIL because the constructors/functions do not yet create deadlines.

- [ ] **Step 3: Compose the request signals per attempt**

Use the same helper in both modules:

```ts
function requestSignal(caller: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}
```

Construct a fresh timeout signal for every token-refresh retry. Map `TimeoutError` to `gmail_timeout`, caller abort to `gmail_cancelled`, and preserve current safe handling for provider status codes. Never include URL query parameters, tokens, response bodies, or email content in an error.

- [ ] **Step 4: Run focused tests**

Run: `pnpm exec vitest run --project unit packages/connectors/src/gmail-client.unit.test.ts apps/worker/src/google-gmail-access.unit.test.ts`

Expected: PASS; a stalled request aborts once, 5xx retries remain bounded to the existing attempt count, and an external abort prevents further retries.

- [ ] **Step 5: Commit provider deadlines**

```bash
git add packages/connectors/src/gmail-client.ts packages/connectors/src/gmail-client.unit.test.ts apps/worker/src/google-gmail-access.ts apps/worker/src/google-gmail-access.unit.test.ts
git commit -m "fix: bound Gmail provider requests"
```

### Task 7: Recursively Sanitize Worker Logs

**Files:**
- Create: `apps/worker/src/log-sanitizer.ts`
- Create: `apps/worker/src/log-sanitizer.unit.test.ts`
- Modify: `apps/worker/src/logger.ts`
- Modify: `apps/worker/src/logger.unit.test.ts`

**Interfaces:**
- Consumes: unknown log bindings.
- Produces: `sanitizeLogValue(value, options?)` returning JSON-safe, bounded, redacted data.

- [ ] **Step 1: Write nested redaction tests**

```ts
it("redacts sensitive keys and contact-shaped values at arbitrary nesting", () => {
  const input = {
    provider: {
      attempts: [{ authorization: "Bearer secret", payload: { email: "person@example.test", phone: "+1 617 555 1212" } }],
      safeCode: "gmail_timeout"
    }
  };
  const serialized = JSON.stringify(sanitizeLogValue(input));
  expect(serialized).toContain("gmail_timeout");
  expect(serialized).not.toContain("Bearer secret");
  expect(serialized).not.toContain("person@example.test");
  expect(serialized).not.toContain("617 555 1212");
});

it("bounds cycles, depth, strings, arrays, and object entries", () => {
  const cyclic: Record<string, unknown> = { safeCode: "worker_error" };
  cyclic.self = cyclic;
  expect(() => JSON.stringify(sanitizeLogValue(cyclic))).not.toThrow();
});
```

- [ ] **Step 2: Run tests and confirm the missing sanitizer failure**

Run: `pnpm exec vitest run --project unit apps/worker/src/log-sanitizer.unit.test.ts apps/worker/src/logger.unit.test.ts`

Expected: FAIL because `sanitizeLogValue` does not exist.

- [ ] **Step 3: Implement the bounded recursive sanitizer**

```ts
const sensitiveKey = /(?:authorization|cookie|password|secret|api.?key|token|code.?verifier|email|phone|contact|evidence|prompt|raw|snapshot|request.?body|response.?body)/iu;
const emailValue = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const phoneValue = /(?:\+?\d[\d .()-]{7,}\d)/u;

export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") {
    if (emailValue.test(value) || phoneValue.test(value)) return "[REDACTED]";
    return value.length > 2_048 ? `${value.slice(0, 2_048)}[TRUNCATED]` : value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return "[UNSERIALIZABLE]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeLogValue(entry, depth + 1, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, entry]) => [
    key,
    sensitiveKey.test(key) ? "[REDACTED]" : sanitizeLogValue(entry, depth + 1, seen)
  ]));
}
```

Apply it through Pino's `formatters.log` so every structured binding is sanitized before serialization. Keep Pino's existing top-level redact list as defense in depth.

- [ ] **Step 4: Prove the real logger output contains only safe metadata**

Create a Pino destination stream, log the nested fixture, parse the emitted JSON, and assert `service`, `correlationId`, `safeCode`, and `retryable` remain while every secret/contact value is absent.

Run: `pnpm exec vitest run --project unit apps/worker/src/log-sanitizer.unit.test.ts apps/worker/src/logger.unit.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit log sanitation**

```bash
git add apps/worker/src/log-sanitizer.ts apps/worker/src/log-sanitizer.unit.test.ts apps/worker/src/logger.ts apps/worker/src/logger.unit.test.ts
git commit -m "fix: redact nested worker log data"
```

### Task 8: Close Documentation, CI, and Audit Statuses

**Files:**
- Modify: `.env.example`
- Modify: `infra/maritime/ENVIRONMENT.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/SECURITY_REVIEW.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: all controls delivered in Tasks 2 through 7.
- Produces: documented server-only configuration and evidence-linked finding statuses.

- [ ] **Step 1: Document the server-only allowlist and Gmail boundary**

Add this environment entry without a value:

```dotenv
# Exact founder Vera UUIDs allowed to use the experimental browser bridge.
# Missing or malformed configuration denies job creation, dispatch, and execution.
VERA_BROWSER_FOUNDER_USER_IDS=
```

State in `docs/SECURITY.md` that the same allowlist is rechecked at creation, dispatch, and execution; ordinary operators are not implicitly browser-enabled. State that founder release Gmail is alert ingestion through `gmail.readonly` only and that CI rejects compose/send/modify capability.

- [ ] **Step 2: Update finding evidence and statuses without deleting history**

For `SEC-001`, `SEC-005`, `SEC-006`, `SEC-007`, and `SEC-008`, change status from `Open` to `Resolved` only after linking the exact tests and commands. Leave infrastructure, migration, cleanup, privacy, and live-staging findings open for the other two plans.

- [ ] **Step 3: Run the application-boundary gate**

Run:

```bash
pnpm verify:web-mutation-boundaries
pnpm verify:gmail-boundaries
pnpm verify:browser-boundaries
pnpm test:unit
pnpm lint
pnpm typecheck
```

Expected: every command exits `0`; the default tests make no external call.

- [ ] **Step 4: Review the diff for secret-bearing examples and new side effects**

Run:

```bash
git diff --check
git diff -- . ':!pnpm-lock.yaml' | rg -n "gmail\.compose|gmail\.modify|messages\.send|drafts\.send|mail\.google\.com|password|cookie|OPENCLAW_GATEWAY_TOKEN=.+|MARITIME_API_KEY=.+"
```

Expected: no production capability hit and no populated secret assignment; documented prohibitions may appear only in security text and test fixtures.

- [ ] **Step 5: Commit the application-boundary closeout**

```bash
git add .env.example infra/maritime/ENVIRONMENT.md docs/SECURITY.md docs/SECURITY_REVIEW.md .github/workflows/ci.yml package.json
git commit -m "docs: record application security controls"
```
