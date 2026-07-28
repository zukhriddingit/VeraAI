# Web Google Runtime Lazy-Loading Design

## Status

Approved for implementation planning on 2026-07-27.

## Problem

The hosted Vera web service is constrained to a 1 GB Railway replica. During the
founder sign-in flow, Railway observed approximately 832 MB of current memory
usage and a recent peak of approximately 985 MB. The Node process then failed at
its V8 heap limit and Railway returned HTTP 502.

The hosted application currently imports Calendar and Gmail composition modules
at process startup even when `VERA_INTEGRATIONS_DISABLED=1`. Those modules import
the top-level `googleapis` package. In a fresh local Node process, importing
`googleapis` alone increased resident memory by approximately 127 MB and used
approximately 61 MB of additional JavaScript heap.

The disabled founder demo must not pay the runtime cost of capabilities that are
explicitly unavailable.

## Goals

- When integrations are disabled, startup composition must load no Google
  Calendar or Gmail provider runtime.
- Existing Google Calendar and Gmail behavior must remain unchanged when
  integrations are enabled.
- The public `VeraApplication` contract must remain stable:
  `calendar.configurationState`, `calendar.oauth`, `calendar.createClient`, and
  `gmailOAuth` retain their current meanings.
- The first enabled Google operation must load the provider runtime once.
- Concurrent first operations must share one in-flight load.
- Provider and authorization failures must remain typed and visible.
- Local tests must protect the lazy-loading boundary.
- The live Railway acceptance target is less than approximately 700 MB after a
  clean restart and completed founder sign-in on the existing 1 GB replica.

## Non-goals

- Do not remove Gmail or Calendar support.
- Do not change OAuth scopes, redirect URIs, token storage, PKCE, encryption, or
  human-approval requirements.
- Do not replace `googleapis` with scoped provider packages in this slice.
- Do not change the database, authentication provider, Railway plan, or replica
  limit.
- Do not enable browser execution, live agent search, Gmail, Calendar, or any
  other disabled capability.
- Do not change the root worker image or Maritime assets.
- Do not migrate the authenticated application to another host.
- Do not add Next.js standalone packaging in this slice; that is a separate
  follow-up optimization after the import boundary is measured.

## Considered approaches

### 1. Lazy integration facades

Keep application composition synchronous and preserve existing route-facing
interfaces. Lightweight facades dynamically import the configured Google
implementation only when an enabled operation is called. A single cached promise
constructs and shares the real Calendar OAuth, Gmail OAuth, and Calendar client
composition.

This is the selected approach because it directly removes the disabled-mode
startup cost without changing every route or changing provider behavior.

### 2. Asynchronous application composition

Change `getHostedApplication()` and every page and route that consumes it to be
asynchronous. Application construction could then conditionally import Google
modules.

This is rejected because it spreads an infrastructure optimization across the
entire web request surface and creates unnecessary authentication and readiness
regression risk.

### 3. Scoped Google packages or alternate hosting

Replace the top-level provider package with scoped Google clients, or move the
web process to another host.

Both may be useful later. They are rejected for this slice because they alter
more provider or infrastructure behavior than necessary and do not first prove
that disabled capabilities are isolated.

## Architecture

### Lightweight disabled composition

`apps/web/lib/server/application.ts` must have no runtime import of:

- `calendar-application.ts`;
- `google-integration-oauth.ts`;
- `gmail-integration-oauth.ts`;
- `googleapis`;
- `google-auth-library`;
- the `@vera/calendar` root barrel, which re-exports the Google client.

A small disabled Calendar factory returns the existing
`CalendarApplicationDependencies` shape with:

- `configurationState: "unconfigured"`;
- `oauth: null`;
- `createClient()` rejecting with the existing
  `CalendarProviderError("calendar_disconnected", false, 409)`.

To preserve error identity without loading the provider client,
`@vera/calendar` exposes a lightweight `./errors` subpath that maps directly to
`src/errors.ts`. The disabled factory imports only that subpath and uses a
type-only import for the Calendar application contract.

When `VERA_INTEGRATIONS_DISABLED=1`, `createPostgresApplication()` selects this
disabled factory and sets `gmailOAuth` to `null`. It does not create a lazy
provider loader.

### Lazy configured composition

A new lightweight module owns the configured facades. It uses only type imports
from the existing Google implementation modules.

The module exposes a factory that receives the validated Google configuration and
the user repository provider. It returns:

- a configured `CalendarApplicationDependencies` facade;
- a non-null `GmailIntegrationOAuth` facade.

The facade owns a closure-scoped cached promise. On the first method call, the
promise dynamically imports the existing Calendar application, Google OAuth, and
Gmail OAuth modules. It constructs one real Google OAuth object, uses that same
object for Calendar composition, constructs one Gmail OAuth object, and returns
the three real bindings.

Every facade method awaits the shared binding promise and delegates its exact
input unchanged. Subsequent calls reuse the resolved bindings. Concurrent calls
await the same in-flight promise.

The application still reports `configurationState: "configured"` before the
provider modules are loaded. This preserves current Settings UI behavior.

### Loader failure

Existing typed errors thrown by loaded provider modules pass through unchanged.
If the dynamic module load or provider composition itself fails before a real
binding exists, the facade must:

- clear the rejected cached promise so a later request can retry;
- surface a sanitized provider-unavailable error;
- avoid logging module paths, environment values, tokens, or provider payloads.

The lightweight error used for this boundary must not import `googleapis`.

## Data flow

Disabled mode:

```text
request
  -> getHostedApplication
  -> parse hosted policy
  -> lightweight unconfigured Calendar facade
  -> gmailOAuth = null
  -> no Google provider module load
```

Enabled mode:

```text
request for Calendar or Gmail operation
  -> stable VeraApplication facade
  -> shared lazy binding promise
  -> dynamic provider module imports
  -> existing OAuth and Calendar factories
  -> unchanged provider operation and typed result
```

No connector, browser, worker, or release-gate data flow changes.

## Testing

### Unit tests

- Disabled application composition does not invoke the configured integration
  factory.
- The disabled Calendar facade retains the current disconnected error and HTTP
  status.
- Constructing configured facades does not call the loader.
- The first Calendar OAuth operation calls the loader exactly once.
- The first Gmail OAuth operation calls the loader exactly once.
- Concurrent Calendar and Gmail first operations share one loader call.
- Later operations reuse the resolved bindings.
- Delegated arguments and results are unchanged.
- A rejected loader is cleared and a later operation may retry.
- Existing provider errors from the resolved implementation pass through
  unchanged.

### Static boundary verifier

Add a TypeScript-based verifier following the repository's existing boundary
scripts. It rejects runtime imports from hosted startup composition to the heavy
Google modules or the `@vera/calendar` root barrel. Its table-driven tests must
prove that type-only imports and the approved dynamic-loader module are allowed,
while direct or aliased runtime imports are rejected.

The verifier is added to the affected validation commands so CI cannot
accidentally restore the eager boundary.

### Local validation

Run:

- the new lazy-runtime unit tests;
- the application and Calendar composition unit tests;
- relevant Google OAuth and Gmail OAuth tests;
- the static runtime-boundary verifier and its tests;
- `pnpm typecheck`;
- `pnpm build`;
- `git diff --check`.

A fresh-process diagnostic records the application import memory before and
after the repair. This diagnostic is evidence, not a cross-platform hard CI
threshold; the deterministic boundary tests are the CI guard.

### Live acceptance

After normal PR review, CI, merge, and an explicitly authorized Railway
deployment:

1. restart the 1 GB web replica;
2. verify `/api/health` and `/api/ready`;
3. begin a new Google sign-in flow;
4. complete the callback and load the authenticated dashboard;
5. verify no process restart or HTTP 502;
6. inspect Railway memory metrics over the flow;
7. accept the repair only when the observed peak is below approximately 700 MB.

If the peak remains above the target, do not raise the paid resource ceiling as
part of this change. Measure the remaining runtime and consider scoped Google
packages and Next.js standalone packaging as separate follow-ups.

## Security and release boundaries

- No secret values are read, printed, copied, or changed.
- No OAuth, Gmail, Calendar, browser, or live-search capability is enabled.
- No deployment occurs during implementation.
- Tests use only synthetic values and mock providers.
- The existing landing-page deployment is untouched.
- The repair uses a clean branch based on current remote `main`; unrelated
  release worktrees remain untouched.
