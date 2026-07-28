# Web Google Runtime Lazy-Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Vera's Google Calendar/Gmail implementation out of the hosted web process startup path, especially when `VERA_INTEGRATIONS_DISABLED=1`, while preserving the current `VeraApplication` contract and loading the configured Google runtime exactly once on first use.

**Architecture:** Extract the Google integration interfaces and safe error types into a lightweight contract module, split the disabled Calendar adapter from the Google-backed adapter, and add a closure-scoped cached dynamic loader that returns Calendar and Gmail facades without importing `googleapis` during application composition. A TypeScript-AST boundary verifier prevents static heavy imports from returning to the startup path, and a diagnostic records fresh-process import memory without exposing environment values.

**Tech Stack:** Node.js 24, TypeScript 6, Next.js 16, pnpm 11, Vitest 4, Zod, PostgreSQL, `googleapis`, `google-auth-library`, and the TypeScript compiler API.

## Global Constraints

- Work only in `/private/tmp/vera-web-memory-lazy-loading` on branch `codex/web-memory-lazy-loading`.
- Before every commit, verify that this path is the repository root and that no other worktree was modified.
- Do not change Railway configuration, deploy, dispatch workflows, enable integrations, inspect secrets, or modify the landing-page deployment.
- Preserve the public `VeraApplication` shape and all Calendar/Gmail behavior.
- Preserve fail-closed behavior when integrations are disabled or unconfigured.
- Preserve exact OAuth scopes, redirect validation, token encryption, provider timeouts, policy checks, and error redaction.
- Do not replace `googleapis` with scoped packages and do not enable Next.js standalone output in this change.
- Do not add a memory threshold to CI; the diagnostic is evidence, while the import boundary is the deterministic gate.
- Use injected loaders and sanitized synthetic values in tests. Tests must not call Google, Railway, or any live provider.

---

### Task 1: Establish lightweight Calendar and Google contracts

**Files:**
- Modify: `packages/calendar/package.json`
- Create: `apps/web/lib/server/google-integration-contracts.ts`
- Create: `apps/web/lib/server/unconfigured-calendar-application.ts`
- Modify: `apps/web/lib/server/google-integration-oauth.ts`
- Modify: `apps/web/lib/server/gmail-integration-oauth.ts`
- Modify: `apps/web/lib/server/calendar-application.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/calendar-service.ts`
- Modify: `apps/web/app/api/integrations/google/calendar/authorize/route.ts`
- Modify: `apps/web/app/api/integrations/google/calendar/callback/route.ts`
- Modify: `apps/web/app/api/integrations/google/gmail/authorize/route.ts`
- Modify: `apps/web/app/api/integrations/google/gmail/callback/route.ts`
- Modify: `apps/web/app/api/integrations/google/disconnect/route.ts`
- Create: `apps/web/lib/server/unconfigured-calendar-application.unit.test.ts`
- Modify: `apps/web/lib/server/calendar-application.unit.test.ts`
- Modify: `apps/web/lib/server/session.unit.test.ts`
- Modify: `apps/web/app/api/availability/rules/route.integration.test.ts`
- Modify: `apps/web/app/api/ready/route.integration.test.ts`

**Interfaces:**
- `@vera/calendar/errors` exports the lightweight `CalendarProviderError` without evaluating the package root or Google client.
- `google-integration-contracts.ts` exports the existing OAuth interfaces and error classes without importing `googleapis` or `google-auth-library`.
- `createUnconfiguredCalendarApplication()` preserves the existing `CalendarApplicationDependencies` behavior without importing the Google-backed Calendar implementation.

- [ ] **Step 1: Add the failing disabled-adapter regression test**

Move the existing "fails closed when hosted integration OAuth is unconfigured" case into
`unconfigured-calendar-application.unit.test.ts` and import:

```ts
import { CalendarProviderError } from "@vera/calendar/errors";
import { createUnconfiguredCalendarApplication } from "./unconfigured-calendar-application.ts";
```

Assert the adapter still reports `configurationState: "unconfigured"`, exposes `oauth: null`, and
rejects `createClient()` with:

```ts
new CalendarProviderError("calendar_disconnected", false, 409)
```

- [ ] **Step 2: Prove the new subpath and module do not exist yet**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/unconfigured-calendar-application.unit.test.ts
```

Expected: FAIL because `@vera/calendar/errors` and the new adapter module do not exist.

- [ ] **Step 3: Export the lightweight Calendar error subpath**

Add to `packages/calendar/package.json`:

```json
"./errors": "./src/errors.ts"
```

Do not change the existing `"."` or `"./mock"` exports.

- [ ] **Step 4: Extract the lightweight Google contract**

Move, without semantic changes, these declarations from `google-integration-oauth.ts` into
`google-integration-contracts.ts`:

```ts
GoogleIntegrationOAuthErrorCode
GoogleIntegrationOAuthError
GoogleOAuthProviderErrorCode
GoogleOAuthProviderError
GoogleOAuthTokenSet
VerifiedGoogleIdentity
VerifiedGoogleTokenInfo
RefreshedGoogleAccessToken
GoogleOAuthTransport
SafeOAuthLogger
GoogleIntegrationOAuth
GoogleIntegrationOAuthDependencies
```

The contract module may import domain/database/configuration types with `import type`, but it must
not import `googleapis`, `google-auth-library`, or any provider implementation.

Re-export these declarations from `google-integration-oauth.ts` so existing external imports remain
source-compatible while startup-safe call sites import directly from the contract module.

- [ ] **Step 5: Update lightweight consumers**

Change `application-registry.ts`, `calendar-application.ts`, and the new disabled adapter to use
type-only imports from `google-integration-contracts.ts`.

Change Calendar services and all five Google API routes listed above to import
`GoogleIntegrationOAuthError` from `google-integration-contracts.ts`. This keeps their existing
`instanceof` behavior and sanitized HTTP status mapping while avoiding an eager provider import.

Change `gmail-integration-oauth.ts` to import the shared interfaces/errors from the contract module
and import only `createOfficialGoogleOAuthTransport` from the implementation module.

- [ ] **Step 6: Split the disabled adapter**

Implement:

```ts
export function createUnconfiguredCalendarApplication(): CalendarApplicationDependencies {
  return {
    configurationState: "unconfigured",
    oauth: null,
    async createClient() {
      throw new CalendarProviderError("calendar_disconnected", false, 409);
    }
  };
}
```

Remove this factory and the runtime `CalendarProviderError` import from
`calendar-application.ts`. Update all tests that currently import the disabled factory from the
Google-backed module.

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/unconfigured-calendar-application.unit.test.ts \
  apps/web/lib/server/calendar-application.unit.test.ts \
  apps/web/lib/server/google-integration-oauth.unit.test.ts \
  apps/web/lib/server/gmail-integration-oauth.unit.test.ts \
  apps/web/lib/server/session.unit.test.ts
pnpm typecheck
```

Expected: PASS. Provider errors retain their original classes and error codes.

- [ ] **Step 8: Commit the contract split**

Verify isolation:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Then:

```bash
git add packages/calendar/package.json \
  apps/web/lib/server/google-integration-contracts.ts \
  apps/web/lib/server/unconfigured-calendar-application.ts \
  apps/web/lib/server/google-integration-oauth.ts \
  apps/web/lib/server/gmail-integration-oauth.ts \
  apps/web/lib/server/calendar-application.ts \
  apps/web/lib/server/application-registry.ts \
  apps/web/lib/calendar-service.ts \
  apps/web/app/api/integrations/google \
  apps/web/lib/server/unconfigured-calendar-application.unit.test.ts \
  apps/web/lib/server/calendar-application.unit.test.ts \
  apps/web/lib/server/session.unit.test.ts \
  apps/web/app/api/availability/rules/route.integration.test.ts \
  apps/web/app/api/ready/route.integration.test.ts
git commit -m "refactor: isolate lightweight google contracts"
```

---

### Task 2: Specify the lazy configured runtime with table-driven tests

**Files:**
- Create: `apps/web/lib/server/google-integration-runtime.unit.test.ts`

**Interfaces:**
- Consumes an injected `GoogleIntegrationRuntimeLoader`.
- Produces stable `calendar` and `gmailOAuth` facades.
- Loads configured bindings only when the first facade method is called.
- Shares one in-flight promise, caches one successful binding, and retries after a failed load.

- [ ] **Step 1: Define synthetic bindings and a loader spy**

Build fully synthetic `CalendarApplicationDependencies`, `GoogleIntegrationOAuth`, and
`GmailIntegrationOAuth` doubles. No test value may look like a real token, credential, email, or
provider payload.

- [ ] **Step 2: Add table-driven delegation cases**

Cover every facade method:

| Facade | Methods |
|---|---|
| Calendar client | `createClient` |
| Calendar OAuth | `createAuthorization`, `handleCallback`, `handleDeniedCallback`, `refreshAccessToken`, `disconnect` |
| Gmail OAuth | `createAuthorization`, `handleCallback`, `handleDeniedCallback` |

For each case, assert:

- construction does not invoke the loader;
- the first method loads the binding;
- the exact arguments are delegated;
- the exact result or provider error is returned unchanged.

- [ ] **Step 3: Add cache, concurrency, and retry cases**

Add cases proving:

1. two sequential calls invoke the loader once;
2. concurrent first calls share one loader promise;
3. a rejected loader produces a sanitized
   `GoogleIntegrationOAuthError("provider_unavailable", 503)`;
4. no original loader message or stack is exposed through the new error;
5. a rejected load clears the cache so the next call can retry;
6. a provider-operation rejection after a successful load is not wrapped.

- [ ] **Step 4: Prove the runtime tests fail**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/google-integration-runtime.unit.test.ts
```

Expected: FAIL because `google-integration-runtime.ts` does not exist.

---

### Task 3: Implement and wire the cached Google runtime

**Files:**
- Create: `apps/web/lib/server/google-integration-runtime.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/server/application.unit.test.ts`
- Modify: `apps/web/lib/server/google-integration-runtime.unit.test.ts`

**Interfaces:**

```ts
export interface GoogleIntegrationBindings {
  readonly calendar: CalendarApplicationDependencies;
  readonly gmailOAuth: GmailIntegrationOAuth;
}

export type GoogleIntegrationRuntimeLoader = (
  input: GoogleIntegrationRuntimeInput
) => Promise<GoogleIntegrationBindings>;

export function createLazyGoogleIntegrationBindings(
  input: GoogleIntegrationRuntimeInput & {
    readonly loader?: GoogleIntegrationRuntimeLoader;
  }
): GoogleIntegrationBindings;
```

- [ ] **Step 1: Implement the default dynamic loader**

The default loader must use dynamic imports only:

```ts
const [calendarModule, calendarOAuthModule, gmailOAuthModule] = await Promise.all([
  import("./calendar-application.ts"),
  import("./google-integration-oauth.ts"),
  import("./gmail-integration-oauth.ts")
]);
```

After import, create one real Calendar OAuth object, one hosted Calendar application, and one Gmail
OAuth object from the supplied configuration and repository provider.

- [ ] **Step 2: Implement one shared, reset-on-failure cache**

Keep `pending: Promise<GoogleIntegrationBindings> | null` in the returned runtime's closure.
Construction must not call the loader. The first facade operation initializes `pending`. All
concurrent operations await the same promise. A successful promise remains cached. A rejected
promise resets `pending` to `null` and throws a new lightweight
`GoogleIntegrationOAuthError("provider_unavailable", 503)`.

Do not log the caught error and do not include its message, stack, or cause in the replacement.

- [ ] **Step 3: Implement stable facades**

Return:

- `calendar.configurationState === "configured"`;
- a non-null Calendar OAuth facade;
- a Gmail OAuth facade.

Each method awaits the shared binding and delegates exactly once. Use explicit interface types so a
future method addition fails TypeScript compilation until the facade is updated.

- [ ] **Step 4: Rewire hosted application composition**

`application.ts` must statically import only:

```ts
createUnconfiguredCalendarApplication
createLazyGoogleIntegrationBindings
```

It must not statically import the three Google-backed implementation modules.

When `googleIntegration === null`, return the lightweight disabled Calendar adapter and
`gmailOAuth: null` without constructing the lazy runtime.

When Google is configured, create one lazy binding object and assign both:

```ts
calendar: googleBindings.calendar
gmailOAuth: googleBindings.gmailOAuth
```

The public `VeraApplication` contract remains unchanged.

- [ ] **Step 5: Add application-composition regression coverage**

Extract or inject only the smallest pure composition seam needed to test both branches without
opening PostgreSQL:

- disabled composition never invokes the lazy binding factory;
- configured composition returns Calendar and Gmail objects from the same binding;
- constructing either branch performs no provider call.

Do not mock `googleapis`; the runtime unit tests use the explicit loader seam.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/google-integration-runtime.unit.test.ts \
  apps/web/lib/server/application.unit.test.ts \
  apps/web/lib/server/unconfigured-calendar-application.unit.test.ts \
  apps/web/lib/server/calendar-application.unit.test.ts
pnpm typecheck
```

Expected: PASS. The loader is called zero times at composition, once under sequential/concurrent
use, and again only after a rejected load.

- [ ] **Step 7: Commit the lazy runtime**

Verify the isolated worktree, then:

```bash
git add apps/web/lib/server/google-integration-runtime.ts \
  apps/web/lib/server/google-integration-runtime.unit.test.ts \
  apps/web/lib/server/application.ts \
  apps/web/lib/server/application.unit.test.ts
git commit -m "perf: lazy load web google runtime"
```

---

### Task 4: Add a fail-closed startup import boundary

**Files:**
- Create: `scripts/verify-web-runtime-boundaries.ts`
- Create: `scripts/verify-web-runtime-boundaries.unit.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- `findWebRuntimeBoundaryViolations(files): readonly WebRuntimeBoundaryViolation[]`
- CLI command: `pnpm verify:web-runtime-boundaries`

- [ ] **Step 1: Add table-driven failing verifier tests**

Use synthetic source maps and the TypeScript compiler API. Reject startup modules that contain a
runtime import, re-export, `require()`, or unauthorized dynamic `import()` of:

```text
./calendar-application.ts
./google-integration-oauth.ts
./gmail-integration-oauth.ts
googleapis
google-auth-library
@vera/calendar
```

Accept:

- `import type` from heavy modules;
- `@vera/calendar/errors`;
- `google-integration-contracts.ts`;
- the three exact dynamic imports in the designated
  `apps/web/lib/server/google-integration-runtime.ts` loader.

Add mutations for an extra dynamic import location, a package-root Calendar import, and a static
provider import in each guarded startup file.

- [ ] **Step 2: Prove the verifier tests fail**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/verify-web-runtime-boundaries.unit.test.ts
```

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the AST verifier**

Follow the existing `verify-web-mutation-boundaries.ts` conventions:

- parse TypeScript with source locations;
- return all violations, not just the first;
- print only file, line, import specifier, and a fixed safe message;
- inspect the real guarded files from repository root;
- set a nonzero exit code on any violation.

Guard at least:

```text
apps/web/lib/server/application.ts
apps/web/lib/server/unconfigured-calendar-application.ts
apps/web/lib/server/google-integration-contracts.ts
apps/web/lib/server/google-integration-runtime.ts
```

The designated runtime file may contain only the three reviewed dynamic provider imports.

- [ ] **Step 4: Wire the verifier into local scripts and CI**

Add:

```json
"verify:web-runtime-boundaries": "tsx scripts/verify-web-runtime-boundaries.ts"
```

Add a CI step immediately after the existing web mutation boundary:

```yaml
- name: Verify web runtime boundaries
  run: pnpm verify:web-runtime-boundaries
```

- [ ] **Step 5: Run the verifier and focused tests**

Run:

```bash
pnpm verify:web-runtime-boundaries
pnpm exec vitest run --project unit \
  scripts/verify-web-runtime-boundaries.unit.test.ts \
  apps/web/lib/server/google-integration-runtime.unit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the import gate**

Verify the isolated worktree, then:

```bash
git add scripts/verify-web-runtime-boundaries.ts \
  scripts/verify-web-runtime-boundaries.unit.test.ts \
  package.json \
  .github/workflows/ci.yml
git commit -m "test: enforce lightweight web startup"
```

---

### Task 5: Add a sanitized startup-memory diagnostic

**Files:**
- Create: `scripts/measure-web-startup-memory.ts`
- Create: `scripts/measure-web-startup-memory.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- `measureImportedModuleMemory(importModule): Promise<StartupMemoryMeasurement>`
- CLI command: `pnpm diagnose:web-startup-memory`

- [ ] **Step 1: Add the failing diagnostic unit test**

Inject a synthetic importer and assert the result contains numeric, nonnegative:

```ts
{
  rssBeforeMb,
  rssAfterMb,
  rssDeltaMb,
  heapUsedBeforeMb,
  heapUsedAfterMb,
  heapUsedDeltaMb
}
```

Assert output contains no environment entries, process arguments, module exports, paths, tokens, or
exception details.

- [ ] **Step 2: Prove the test fails**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/measure-web-startup-memory.unit.test.ts
```

Expected: FAIL because the diagnostic module does not exist.

- [ ] **Step 3: Implement the diagnostic**

Measure `process.memoryUsage()` immediately before and after importing
`apps/web/lib/server/application.ts`. Round byte values to one decimal MiB. Print exactly one JSON
object containing only the six numeric fields above.

The CLI must not construct a database connection, parse secrets, print module names, or enable
Google integrations. This is an import-graph diagnostic, not a live readiness check.

- [ ] **Step 4: Add the package command**

Add:

```json
"diagnose:web-startup-memory": "tsx scripts/measure-web-startup-memory.ts"
```

Do not add the diagnostic to CI and do not enforce an absolute local threshold.

- [ ] **Step 5: Run the unit test and three fresh diagnostics**

Run:

```bash
pnpm exec vitest run --project unit \
  scripts/measure-web-startup-memory.unit.test.ts
pnpm diagnose:web-startup-memory
pnpm diagnose:web-startup-memory
pnpm diagnose:web-startup-memory
```

Expected: all commands exit zero; each diagnostic prints only numeric memory data. Record the three
results in the final task report, not in a committed evidence record.

- [ ] **Step 6: Commit the diagnostic**

Verify the isolated worktree, then:

```bash
git add scripts/measure-web-startup-memory.ts \
  scripts/measure-web-startup-memory.unit.test.ts \
  package.json
git commit -m "chore: add web startup memory diagnostic"
```

---

### Task 6: Validate behavior, build, and review the complete change

**Files:**
- Review all changed files.
- No deployment or remote mutation in this task.

- [ ] **Step 1: Run formatting and deterministic boundaries**

```bash
pnpm format:check
pnpm verify:web-runtime-boundaries
pnpm verify:web-mutation-boundaries
pnpm verify:calendar-boundaries
pnpm verify:gmail-boundaries
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Run focused unit and integration tests**

```bash
pnpm exec vitest run --project unit \
  apps/web/lib/server/application.unit.test.ts \
  apps/web/lib/server/unconfigured-calendar-application.unit.test.ts \
  apps/web/lib/server/calendar-application.unit.test.ts \
  apps/web/lib/server/google-integration-runtime.unit.test.ts \
  apps/web/lib/server/google-integration-oauth.unit.test.ts \
  apps/web/lib/server/gmail-integration-oauth.unit.test.ts \
  scripts/verify-web-runtime-boundaries.unit.test.ts \
  scripts/measure-web-startup-memory.unit.test.ts
pnpm exec vitest run --project integration \
  apps/web/app/api/availability/rules/route.integration.test.ts \
  apps/web/app/api/ready/route.integration.test.ts
```

Expected: PASS with no network calls.

- [ ] **Step 3: Run workspace typecheck and production build**

```bash
pnpm typecheck
pnpm build
```

Expected: PASS. Review the Next.js build output for an accidental provider import error or route
regression.

- [ ] **Step 4: Run the full unit suite**

```bash
pnpm test:unit
```

Expected: PASS.

- [ ] **Step 5: Review the diff for boundaries and secrets**

Run:

```bash
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git diff origin/main...HEAD -- \
  apps/web/lib/server \
  apps/web/app/api/integrations/google \
  packages/calendar/package.json \
  scripts \
  package.json \
  .github/workflows/ci.yml
git status --short
```

Confirm:

- no secret, environment value, OAuth token, email, or provider response was added;
- no Google scope or authorization behavior changed;
- no live integration was enabled;
- no Railway, deployment, worker, Maritime, browser, or landing-page file changed;
- the dynamic loader is the only approved heavy-import boundary;
- all facades are stable and share one cached binding;
- failed runtime loads are sanitized and retryable;
- provider-operation errors remain unchanged.

- [ ] **Step 6: Record the final local state**

Report:

- branch and exact head;
- files changed;
- commands and results;
- three local diagnostic measurements;
- whether code changes were required;
- unresolved risk: only a live Railway acceptance can establish post-sign-in memory under the
  approximately 700 MB target;
- explicit confirmation that no deployment, workflow dispatch, secret access, or remote action
  occurred.

Do not push, create a PR, merge, or deploy without a new explicit authorization.

## Later live acceptance (not authorized by this plan)

After normal review, CI, merge, and a separate explicit Railway deployment authorization:

1. deploy the exact merged commit;
2. confirm `/api/health` and `/api/ready`;
3. complete founder Google sign-in;
4. repeat the OAuth redirect that previously returned 502;
5. inspect Railway memory without reading environment values;
6. require stable memory below approximately 700 MB through sign-in and one normal dashboard load;
7. if memory remains unsafe, stop and evaluate scoped `@googleapis/*` packages or Next.js standalone
   packaging as separate reviewed changes.
