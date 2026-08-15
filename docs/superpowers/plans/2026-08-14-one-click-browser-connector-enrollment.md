# One-click Browser Connector Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved signed-in Vera beta tester connect the installed Browser Connector with one explicit click and no copied pairing credential, then reconnect automatically on the same Chrome profile until revocation.

**Architecture:** Vera issues a hashed, 60-second, single-use ticket bound to one active per-user Gateway assignment and one opaque extension installation. The extension carries that ticket over a bounded enrollment WebSocket mode on the existing `/browser/extension` route; the route filter authenticates through Vera's assignment checkpoint before returning the existing relay credential directly to extension storage. Browser-search policy, explicit one-tab sharing, revocation, and forbidden-action controls remain independent and fail closed.

**Tech Stack:** TypeScript 6, Zod, Next.js 16 route handlers and React 19, PostgreSQL with Drizzle ORM, Vitest, Manifest V3 Chrome extension JavaScript, Node.js 24, `ws` 8.21.1, pnpm 11.

## Global Constraints

- Preserve the accepted Gateway image `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde` as immutable rollback.
- Preserve PostgreSQL and every existing listing, raw record, provenance row, score, risk signal, and activity event.
- Persist only SHA-256 digests of enrollment tickets and opaque installation identifiers; never persist a raw ticket or relay credential.
- Ticket lifetime is at most 60 seconds, ticket entropy is exactly 256 random bits, and ticket consumption is atomic and single-use.
- Keep the public Gateway path exactly `/browser/extension`; enrollment must not add a second public route.
- Keep Chrome permissions exactly `alarms`, `debugger`, `storage`, `tabGroups`, and `tabs`.
- Connecting never shares a tab. Exactly one explicitly shared tab remains the consent boundary.
- Keep login, 2FA, CAPTCHA, checkpoint, and consent manual.
- Keep every Contact, Apply, Tour, Message, Email, Phone, payment, upload, and download action forbidden.
- Keep `VERA_BROWSER_ENROLLMENT_ENABLED=0`, beta access, assignment routing, and browser-search gates fail-closed by default.
- Do not publish a Gateway image or Chrome Web Store version until focused checks, full CI, signing, SBOM, provenance, vulnerability, privacy, support, and cost gates pass.

---

### Task 1: Define the enrollment protocol and domain invariants

**Files:**
- Create: `packages/domain/src/browser-connector-enrollment.ts`
- Create: `packages/domain/src/browser-connector-enrollment.unit.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/browser-extension-readiness.ts`
- Modify: `packages/domain/src/browser-extension-readiness.unit.test.ts`

**Interfaces:**
- Consumes: `VeraUserIdSchema`, `IsoDateTimeSchema`, and `Sha256Schema` from `@vera/domain` primitives.
- Produces: `BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION`, `BROWSER_CONNECTOR_EXTENSION_VERSION`, `CreateBrowserConnectorEnrollmentRequestSchema`, `CreateBrowserConnectorEnrollmentResponseSchema`, `BrowserConnectorEnrollmentCheckpointRequestSchema`, `BrowserConnectorEnrollmentDecisionSchema`, and extended readiness messages used by Tasks 3–6.

- [ ] **Step 1: Write failing domain tests**

```ts
const issuance = CreateBrowserConnectorEnrollmentRequestSchema.parse({
  confirmation: "connect_read_only_browser",
  extensionVersion: "2.2.0",
  protocolVersion: "1",
  installationDigest: "a".repeat(64),
  idempotencyKey: "b".repeat(64)
});
expect(issuance.confirmation).toBe("connect_read_only_browser");
expect(
  BrowserConnectorEnrollmentCheckpointRequestSchema.safeParse({
    ticket: "A".repeat(43),
    extensionVersion: "2.2.0",
    protocolVersion: "1",
    installationId: "c".repeat(64),
    requestedAt: "2026-08-14T12:00:00.000Z"
  }).success
).toBe(true);
expect(
  BrowserConnectorEnrollmentCheckpointRequestSchema.safeParse({
    ticket: "short",
    extensionVersion: "2.2.0",
    protocolVersion: "1",
    installationId: "c".repeat(64),
    requestedAt: "2026-08-14T12:00:00.000Z"
  }).success
).toBe(false);
```

- [ ] **Step 2: Run the domain tests and verify the new exports are missing**

Run: `pnpm vitest run --project unit packages/domain/src/browser-connector-enrollment.unit.test.ts packages/domain/src/browser-extension-readiness.unit.test.ts`

Expected: FAIL because `browser-connector-enrollment.ts` and its exports do not exist.

- [ ] **Step 3: Add the closed protocol schemas**

```ts
export const BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION = "1" as const;
export const BROWSER_CONNECTOR_EXTENSION_VERSION = "2.2.0" as const;
export const BrowserConnectorInstallationIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const BrowserConnectorInstallationDigestSchema = Sha256Schema;
export const BrowserConnectorEnrollmentTicketSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u);

export const CreateBrowserConnectorEnrollmentRequestSchema = z
  .object({
    confirmation: z.literal("connect_read_only_browser"),
    extensionVersion: z.literal(BROWSER_CONNECTOR_EXTENSION_VERSION),
    protocolVersion: z.literal(BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION),
    installationDigest: BrowserConnectorInstallationDigestSchema,
    idempotencyKey: Sha256Schema
  })
  .strict();

export const CreateBrowserConnectorEnrollmentResponseSchema = z
  .object({
    protocolVersion: z.literal(BROWSER_CONNECTOR_ENROLLMENT_PROTOCOL_VERSION),
    ticket: BrowserConnectorEnrollmentTicketSchema,
    expiresAt: IsoDateTimeSchema,
    gatewayOrigin: z.string().url().startsWith("https://")
  })
  .strict();
```

Add strict checkpoint and decision schemas with typed denial reasons:

```ts
export const BrowserConnectorEnrollmentDenialReasonSchema = z.enum([
  "disabled",
  "assignment_unavailable",
  "ticket_invalid",
  "ticket_expired",
  "ticket_replayed",
  "binding_mismatch",
  "version_incompatible",
  "device_conflict"
]);

export const BrowserConnectorEnrollmentDecisionSchema = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true), assignmentId: z.uuid() }).strict(),
  z.object({ allowed: z.literal(false), reason: BrowserConnectorEnrollmentDenialReasonSchema }).strict()
]);
```

Extend `BrowserExtensionReadinessMessageSchema` with exact `extensionVersion`, `enrollmentProtocolVersion`, and `installationDigest` fields while retaining the existing readiness fields.

- [ ] **Step 4: Re-run domain tests**

Run: `pnpm vitest run --project unit packages/domain/src/browser-connector-enrollment.unit.test.ts packages/domain/src/browser-extension-readiness.unit.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the protocol slice**

```bash
git add packages/domain/src/browser-connector-enrollment.ts packages/domain/src/browser-connector-enrollment.unit.test.ts packages/domain/src/browser-extension-readiness.ts packages/domain/src/browser-extension-readiness.unit.test.ts packages/domain/src/index.ts
git commit -m "feat: define browser connector enrollment protocol"
```

### Task 2: Add atomic PostgreSQL device and ticket persistence

**Files:**
- Modify: `packages/db/src/postgres/schema.ts`
- Create: `packages/db/src/postgres/browser-connector-enrollment-repository.ts`
- Create: `packages/db/src/postgres/browser-connector-enrollment-repository.integration.test.ts`
- Modify: `packages/db/src/index.ts`
- Create through Drizzle generation and rename: `packages/db/drizzle/0009_browser_connector_enrollment.sql`
- Modify through Drizzle generation: `packages/db/drizzle/meta/_journal.json`
- Create through Drizzle generation: `packages/db/drizzle/meta/0009_snapshot.json`
- Modify: `packages/db/src/postgres/migrations.integration.test.ts`

**Interfaces:**
- Consumes: active `browserGatewayAssignments` rows and Task 1 schemas.
- Produces: `BrowserConnectorEnrollmentRepository.issue`, `.consume`, `.revokeForUser`, and `.expireBatch` for Task 3.

- [ ] **Step 1: Write failing repository integration tests**

Cover these exact cases:

```ts
const issued = await repository.issue({
  id: crypto.randomUUID(),
  deviceId: crypto.randomUUID(),
  userId,
  assignmentId,
  installationDigest: "a".repeat(64),
  ticketDigest: "b".repeat(64),
  extensionVersion: "2.2.0",
  protocolVersion: "1",
  gatewayOrigin: "https://gateway-a.verahousing.app",
  idempotencyKey: "c".repeat(64),
  issuedAt: "2026-08-14T12:00:00.000Z",
  expiresAt: "2026-08-14T12:01:00.000Z"
});
expect(issued.status).toBe("issued");

const results = await Promise.allSettled([
  repository.consume(consumeInput),
  repository.consume(consumeInput)
]);
expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
```

Also assert cross-owner assignment IDs fail, a different live device fails, lifetimes over 60 seconds fail, raw ticket columns do not exist, revocation closes devices/tickets, and bounded expiry changes only expired issued rows.

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/browser-connector-enrollment-repository.integration.test.ts`

Expected: FAIL because the tables and repository do not exist.

- [ ] **Step 3: Add the schema and repository interfaces**

Define `browserConnectorDevices` with statuses `pending`, `active`, and `revoked`, an owner-assignment foreign key, a SHA-256 installation digest check, and a partial unique index allowing one `pending` or `active` device per assignment.

Define `browserConnectorEnrollmentTickets` with statuses `issued`, `consumed`, `expired`, and `revoked`; owner-assignment-device foreign keys; unique ticket digest and owner-idempotency indexes; a partial unique index for one issued ticket per assignment; and checks for terminal timestamps and a lifetime between one millisecond and 60 seconds.

Expose this exact repository contract:

```ts
export interface BrowserConnectorEnrollmentRepository {
  issue(input: IssueBrowserConnectorEnrollmentInput): Promise<BrowserConnectorEnrollmentTicket>;
  consume(input: ConsumeBrowserConnectorEnrollmentInput): Promise<BrowserConnectorEnrollmentTicket>;
  revokeForUser(input: { userId: VeraUserId; revokedAt: string }): Promise<number>;
  expireBatch(input: { now: string; limit: number }): Promise<number>;
}
```

`consume` must lock the ticket, device, and assignment rows in one transaction, compare every owner/assignment/Gateway/version/protocol/device binding, require an active assignment and unexpired issued ticket, then mark the ticket `consumed` and device `active` exactly once.

- [ ] **Step 4: Generate and inspect migration 0009**

Run: `pnpm db:generate`

Rename the generated SQL file to `0009_browser_connector_enrollment.sql` and set the corresponding
journal tag to `0009_browser_connector_enrollment`.

Expected: one additive `0009_browser_connector_enrollment.sql`, one `0009_snapshot.json`, and one journal entry; no DROP/TRUNCATE statements and no changes to existing listing tables.

- [ ] **Step 5: Run repository and migration tests**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/browser-connector-enrollment-repository.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add packages/db/src/postgres/schema.ts packages/db/src/postgres/browser-connector-enrollment-repository.ts packages/db/src/postgres/browser-connector-enrollment-repository.integration.test.ts packages/db/src/index.ts packages/db/src/postgres/migrations.integration.test.ts packages/db/drizzle
git commit -m "feat: persist one-time browser enrollment tickets"
```

### Task 3: Implement ticket issuance and authenticated checkpoint consumption

**Files:**
- Create: `apps/web/lib/browser-connector-enrollment-service.ts`
- Create: `apps/web/lib/browser-connector-enrollment-service.unit.test.ts`
- Create: `apps/web/app/api/settings/integrations/browser-agent/enrollment/route.ts`
- Create: `apps/web/app/api/settings/integrations/browser-agent/enrollment/route.integration.test.ts`
- Create: `apps/web/app/api/internal/browser-connector/enrollment/checkpoint/route.ts`
- Create: `apps/web/app/api/internal/browser-connector/enrollment/checkpoint/route.unit.test.ts`
- Modify: `apps/web/lib/server/application-registry.ts`
- Modify: `apps/web/lib/server/application.ts`
- Modify: `apps/web/lib/server/browser-gateway-runtime-resolver.ts`
- Modify: `apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts`
- Modify: `apps/web/lib/server/demo-application.ts`
- Modify: `apps/web/lib/server/session.unit.test.ts`
- Modify: `apps/web/app/api/availability/rules/route.integration.test.ts`
- Modify: `apps/web/app/api/ready/route.integration.test.ts`
- Modify: `apps/web/app/api/viewings/[id]/calendar-routes.integration.test.ts`
- Modify: `apps/web/app/api/beta-access/route.unit.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 2 repository, `requireVeraSession`, `readBoundedJson`, and dedicated enrollment authorization added to `BrowserGatewayRuntimeResolver`.
- Produces: authenticated issuance and internal consumption endpoints used by Tasks 4–6.

- [ ] **Step 1: Write failing service and route tests**

Assert that issuance uses 32 random bytes and persists only the digest:

```ts
const response = await issueBrowserConnectorEnrollment(dependencies, request);
expect(response.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
expect(dependencies.enrollments.issue).toHaveBeenCalledWith(
  expect.objectContaining({
    userId,
    assignmentId: assignment.id,
    ticketDigest: createHash("sha256").update(response.ticket).digest("hex")
  })
);
expect(JSON.stringify(dependencies.enrollments.issue.mock.calls)).not.toContain(response.ticket);
```

Route tests must cover authenticated owner selection, same-origin issuance, exact confirmation, `Cache-Control: no-store`, disabled enrollment/beta/routing gates, inactive/revoked assignment, incompatible version, device conflict, and request rate limiting. Internal route tests must prove checkpoint authentication occurs before `readBoundedJson`, a 4 KiB limit, exact origin, cross-tenant denial, replay denial, and secret-free responses.

- [ ] **Step 2: Run the web tests and verify they fail**

Run: `pnpm vitest run --project unit apps/web/lib/browser-connector-enrollment-service.unit.test.ts apps/web/app/api/internal/browser-connector/enrollment/checkpoint/route.unit.test.ts && pnpm vitest run --project integration apps/web/app/api/settings/integrations/browser-agent/enrollment/route.integration.test.ts`

Expected: FAIL because the service, routes, and application binding do not exist.

- [ ] **Step 3: Implement the service with injected entropy and clock**

```ts
export interface BrowserConnectorEnrollmentDependencies {
  readonly userId: VeraUserId;
  readonly authorization: Pick<
    BrowserGatewayRuntimeResolver,
    "resolveEnrollmentForUser"
  >;
  readonly enrollments: BrowserConnectorEnrollmentRepository;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly id: () => string;
}

export function createEnrollmentTicket(randomBytes: (size: number) => Uint8Array): string {
  return Buffer.from(randomBytes(32)).toString("base64url");
}

export function digestEnrollmentSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
```

Add two dedicated resolver methods:

```ts
async resolveEnrollmentForUser(userId: VeraUserId): Promise<BrowserGatewayAssignment | null>;
async authenticateEnrollmentCheckpoint(input: {
  bearerToken: string;
  origin: string;
}): Promise<{ userId: VeraUserId; assignment: BrowserGatewayAssignment }>;
```

Both require exact active assignment ownership and these environment gates before ticket generation:

```ts
environment.VERA_BROWSER_ENROLLMENT_ENABLED === "1";
environment.VERA_BETA_ACCESS_GATE_ENABLED === "1";
environment.VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED === "1";
environment.VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION === "sha256.v1";
```

They also require the exact user in `VERA_BROWSER_BETA_USER_IDS` and active beta membership. They do
not call `resolveAssignment`, inspect node/profile/source readiness, resolve Maritime/signing secrets,
or require `VERA_BROWSER_DISABLED=0`; search jobs remain independently disabled during connection
acceptance. Keep the existing `resolveForUser` and `authenticateCheckpoint` behavior unchanged.

- [ ] **Step 4: Implement the two route handlers and application wiring**

The user route gets `session.userId`, never reads a user or assignment ID from input, checks same-origin mutation policy, parses at most 4 KiB, and maps typed service errors to closed public codes.

The internal route performs:

```ts
const resolved = await requireEnrollmentCheckpoint(request, application.browserGatewayRuntime);
const input = BrowserConnectorEnrollmentCheckpointRequestSchema.parse(
  await readBoundedJson(request, { maxBytes: 4_096 })
);
const decision = await consumeBrowserConnectorEnrollment({
  userId: resolved.userId,
  assignment: resolved.assignment,
  enrollments: application.browserConnectorEnrollments,
  input,
  now: () => new Date()
});
```

Return only `BrowserConnectorEnrollmentDecisionSchema`; never return or resolve relay material in the web application.

- [ ] **Step 5: Run the focused web tests**

Run: `pnpm vitest run --project unit apps/web/lib/browser-connector-enrollment-service.unit.test.ts apps/web/app/api/internal/browser-connector/enrollment/checkpoint/route.unit.test.ts && pnpm vitest run --project integration apps/web/app/api/settings/integrations/browser-agent/enrollment/route.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the application enrollment slice**

```bash
git add apps/web/lib/browser-connector-enrollment-service.ts apps/web/lib/browser-connector-enrollment-service.unit.test.ts apps/web/app/api/settings/integrations/browser-agent/enrollment apps/web/app/api/internal/browser-connector/enrollment apps/web/lib/server/application-registry.ts apps/web/lib/server/application.ts apps/web/lib/server/browser-gateway-runtime-resolver.ts apps/web/lib/server/browser-gateway-runtime-resolver.unit.test.ts apps/web/lib/server/demo-application.ts apps/web/lib/server/session.unit.test.ts apps/web/app/api/availability/rules/route.integration.test.ts apps/web/app/api/ready/route.integration.test.ts 'apps/web/app/api/viewings/[id]/calendar-routes.integration.test.ts' apps/web/app/api/beta-access/route.unit.test.ts
git commit -m "feat: issue one-time browser enrollment tickets"
```

### Task 4: Add the extension enrollment client and persistent device identity

**Files:**
- Create: `infra/chrome/vera-openclaw-extension/modules/enrollment.js`
- Create: `infra/chrome/vera-openclaw-extension/modules/enrollment.d.ts`
- Create: `infra/chrome/vera-openclaw-extension/modules/enrollment.unit.test.ts`
- Modify: `infra/chrome/vera-openclaw-extension/background.js`
- Modify: `infra/chrome/vera-openclaw-extension/background.unit.test.ts`
- Modify: `infra/chrome/vera-openclaw-extension/readiness-bridge.js`
- Create: `infra/chrome/vera-openclaw-extension/readiness-bridge.unit.test.ts`
- Modify: `infra/chrome/vera-openclaw-extension/manifest.json`
- Modify: `infra/chrome/vera-openclaw-extension/popup.html`
- Modify: `infra/chrome/vera-openclaw-extension/popup.js`

**Interfaces:**
- Consumes: Task 1 message contracts and Task 3 issuance response.
- Produces: version 2.2.0 extension support for the Task 5 Gateway protocol and Task 6 UI.

- [ ] **Step 1: Write failing pure enrollment and background tests**

```ts
expect(enrollmentRelayUrl("https://gateway-a.verahousing.app")).toBe(
  "wss://gateway-a.verahousing.app/browser/extension"
);
expect(() => enrollmentRelayUrl("https://gateway-a.verahousing.app/path")).toThrow();
expect(parseEnrollmentResponse({ protocol: "vera-browser-enrollment.v1", token: "a".repeat(64) }))
  .toEqual({ protocol: "vera-browser-enrollment.v1", token: "a".repeat(64) });
```

Background tests must prove a 64-hex-character installation ID is generated once, readiness exposes only its digest, successful enrollment stores `relayUrl` and `token`, failures store neither, restart reconnect uses stored values, connection does not group or attach any tab, and unpair retains `installationId` while removing `relayUrl` and `token`.

- [ ] **Step 2: Run extension tests and verify they fail**

Run: `pnpm vitest run --project unit infra/chrome/vera-openclaw-extension/modules/enrollment.unit.test.ts infra/chrome/vera-openclaw-extension/background.unit.test.ts infra/chrome/vera-openclaw-extension/readiness-bridge.unit.test.ts`

Expected: FAIL because enrollment support does not exist.

- [ ] **Step 3: Implement the enrollment module**

Export exact helpers:

```js
export const ENROLLMENT_PROTOCOL = "vera-browser-enrollment.v1";
export const EXTENSION_VERSION = "2.2.0";
export function enrollmentRelayUrl(gatewayOrigin) {}
export function parseEnrollmentRequest(value) {}
export function parseEnrollmentResponse(value) {}
export function enrollWithGateway(input, dependencies) {}
```

`enrollWithGateway` opens one WebSocket with `ENROLLMENT_PROTOCOL`, sends one JSON frame containing ticket, raw installation ID, extension version, protocol version, and requested time, accepts one response no larger than 4 KiB within ten seconds, validates a 64-hex relay token, closes the socket, and returns the existing relay URL plus token.

- [ ] **Step 4: Implement background and bridge messages**

Add `getEnrollmentIdentity` and `enroll` runtime messages. The content script accepts only exact same-window messages from its configured Vera origin:

```js
if (event.source !== window || event.origin !== window.location.origin) return;
if (event.data?.source !== "vera-web" || event.data?.type !== "connect-browser") return;
```

It forwards the closed request to the service worker and posts back only sanitized connection state. Readiness version becomes `2` and includes extension version, protocol version, and installation digest. No message contains a relay token.

- [ ] **Step 5: Remove the pairing-string UI and increment the manifest**

Set manifest version to `2.2.0`. Replace the popup's pairing textbox with an `Open Vera to connect` link to `https://app.verahousing.app/settings/integrations/browser-agent`. Keep the internal `pair` message temporarily for local rollback tests, but expose no production copy/paste action.

- [ ] **Step 6: Run extension tests**

Run: `pnpm vitest run --project unit infra/chrome/vera-openclaw-extension`

Expected: PASS with no grouped or debugger-attached tab during enrollment.

- [ ] **Step 7: Commit the extension slice**

```bash
git add infra/chrome/vera-openclaw-extension
git commit -m "feat: connect browser extension from Vera"
```

### Task 5: Add bounded Gateway enrollment on the existing route

**Files:**
- Create: `infra/maritime/openclaw/remote-extension-enrollment.mjs`
- Create: `infra/maritime/openclaw/remote-extension-enrollment.unit.test.ts`
- Modify: `infra/maritime/openclaw/remote-extension-route-filter.mjs`
- Modify: `infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts`
- Modify: `infra/maritime/openclaw/remote-extension.Dockerfile`
- Modify: `infra/maritime/openclaw/remote-extension-runtime-lock.json`
- Modify: `infra/maritime/openclaw/sanitize-runtime-dependencies.mjs`
- Modify: `infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts`

**Interfaces:**
- Consumes: extension first-frame contract from Task 4 and checkpoint decision from Task 3.
- Produces: the only component allowed to read the fixed relay credential and return it to the enrolled extension.

- [ ] **Step 1: Write failing route-filter and enrollment tests**

Prove that normal `openclaw-extension-relay` upgrades remain byte-preserving, unknown protocols deny, enrollment never connects upstream, the first frame is limited to 4 KiB and ten seconds, wrong checkpoint decisions return a generic denial, and allowed enrollment reads only the fixed regular `0600` credential file.

```ts
expect(upstreamUpgradeCount).toBe(0);
expect(checkpointRequests).toEqual([
  expect.objectContaining({
    url: "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
    authorization: "Bearer checkpoint-test-token"
  })
]);
expect(JSON.stringify(checkpointRequests)).not.toContain(pairingCredential);
```

- [ ] **Step 2: Run Gateway unit tests and verify they fail**

Run: `pnpm vitest run --project unit infra/maritime/openclaw/remote-extension-enrollment.unit.test.ts infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts`

Expected: FAIL because the enrollment mode does not exist.

- [ ] **Step 3: Implement the bounded enrollment handler**

Expose:

```js
export async function handleEnrollmentUpgrade(request, socket, head, dependencies) {}
```

Require exactly:

```text
VERA_BROWSER_ENROLLMENT_ENABLED=1
VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL=https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint
VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN=https://<dedicated-host>
VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN=<dedicated existing checkpoint credential>
```

Use `WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false })`, accept only `vera-browser-enrollment.v1`, call the exact checkpoint with `cache: no-store`, and read `/data/.openclaw/credentials/browser-extension-relay.secret` with `O_RDONLY | O_NOFOLLOW`. Validate a regular file, mode `0600`, and 64 lowercase hexadecimal bytes before responding. Never log request frames, headers, tickets, tokens, or response bodies.

- [ ] **Step 4: Integrate without adding a route**

In the existing upgrade listener, branch only by the exact WebSocket protocol:

```js
if (request.url !== EXTENSION_ROUTE) return denyUpgrade(clientSocket, "404 Not Found");
if (requestedProtocols(request).includes("vera-browser-enrollment.v1")) {
  void handleEnrollmentUpgrade(request, clientSocket, head, enrollmentDependencies);
  return;
}
forwardRelayUpgrade(request, clientSocket, head);
```

Keep ordinary GET `/browser/extension` returning 426 and every other method/path returning 404.

- [ ] **Step 5: Update the image dependency lock and sanitizer**

Retain only the exact already pinned `ws` runtime files needed by the route filter, bind them in `remote-extension-runtime-lock.json`, and update sanitizer tests to reject extra executable or package surfaces. Increment the OCI version label to `2026.7.1-vera.10`; do not change the OpenClaw base digest during implementation.

- [ ] **Step 6: Run Gateway focused checks**

Run: `pnpm vitest run --project unit infra/maritime/openclaw/remote-extension-enrollment.unit.test.ts infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts infra/maritime/openclaw/sanitize-runtime-dependencies.unit.test.ts && pnpm verify:remote-extension-config && pnpm verify:gateway-runtime-supply-chain`

Expected: PASS; exact public route remains unchanged and normal relay tests remain green.

- [ ] **Step 7: Commit the Gateway slice**

```bash
git add infra/maritime/openclaw
git commit -m "feat: exchange one-time browser enrollment tickets"
```

### Task 6: Build the one-click settings experience and revocation cleanup

**Files:**
- Modify: `apps/web/app/settings/integrations/browser-agent/browser-agent-panel.tsx`
- Modify: `apps/web/app/settings/integrations/browser-agent/page.tsx`
- Create: `apps/web/app/settings/integrations/browser-agent/browser-enrollment-client.ts`
- Create: `apps/web/app/settings/integrations/browser-agent/browser-enrollment-client.unit.test.ts`
- Modify: `apps/web/app/api/settings/integrations/browser-agent/assignment/revoke/route.ts`
- Modify: `apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4 readiness, issuance, and bridge contracts.
- Produces: install, onboarding, connect, connecting, connected, failure, and revoke UI states.

- [ ] **Step 1: Write failing client and route tests**

```ts
expect(connectionAction({ extension: null, assignment: active })).toBe("install");
expect(connectionAction({ extension: compatibleUnpaired, assignment: null })).toBe("onboarding");
expect(connectionAction({ extension: compatibleUnpaired, assignment: active })).toBe("connect");
expect(connectionAction({ extension: compatiblePaired, assignment: active })).toBe("connected");
```

Test that a click creates an idempotency key, posts the exact confirmation, sends the issuance response through the bridge, never renders ticket or Gateway credential text, and displays typed recovery. Revocation must call `browserConnectorEnrollments.revokeForUser` in the same owner-scoped server operation that revokes assignment controls.

- [ ] **Step 2: Run UI and route tests and verify they fail**

Run: `pnpm vitest run --project unit apps/web/app/settings/integrations/browser-agent/browser-enrollment-client.unit.test.ts && pnpm vitest run --project integration apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts`

Expected: FAIL because the client state machine and enrollment revocation are missing.

- [ ] **Step 3: Implement the client state machine**

Export pure `connectionAction` and an async `connectBrowser` that validates readiness version 2, posts issuance, dispatches the exact bridge message, waits at most 15 seconds for a sanitized extension result, and clears all ticket references in `finally`.

Use these visible primary actions exactly:

```text
Install Browser Connector
Waiting for concierge onboarding
Connect this browser
Connecting this browser…
Connected on this browser
Revoke Browser Connector access
```

Before connection, require one unchecked-by-default confirmation stating the connector is read-only, sees only one explicitly shared tab, and never contacts or applies.

- [ ] **Step 4: Integrate local and server revocation**

After successful server revocation, post `clear-browser-connection` to the extension and show success even if that best-effort local message is missed. Server assignment, device, ticket, user, source, node, and profile states must already deny future work before the response returns.

- [ ] **Step 5: Run UI, route, and existing live-search readiness tests**

Run: `pnpm vitest run --project unit apps/web/app/settings/integrations/browser-agent/browser-enrollment-client.unit.test.ts packages/domain/src/browser-extension-readiness.unit.test.ts apps/web/app/live-search-recovery.unit.test.ts && pnpm vitest run --project integration apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts apps/web/app/api/settings/integrations/browser-agent/enrollment/route.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the product experience**

```bash
git add apps/web/app/settings/integrations/browser-agent apps/web/app/api/settings/integrations/browser-agent apps/web/app/globals.css
git commit -m "feat: add one-click browser connection"
```

### Task 7: Extend security verifiers, packaging, documentation, and cleanup

**Files:**
- Modify: `scripts/verify-browser-assignment-boundaries.ts`
- Modify: `scripts/verify-browser-assignment-boundaries.unit.test.ts`
- Modify: `scripts/verify-browser-boundaries.ts`
- Modify: `scripts/verify-remote-extension-config.ts`
- Modify: `scripts/verify-remote-extension-config.unit.test.ts`
- Modify: `scripts/verify-vera-openclaw-extension.ts`
- Modify: `scripts/verify-vera-openclaw-extension.unit.test.ts`
- Modify: `scripts/package-vera-browser-connector.unit.test.ts`
- Modify: `docs/BROWSER_BETA_OPERATIONS.md`
- Modify: `docs/CHROME_WEB_STORE_RELEASE.md`
- Modify: `docs/BROWSER_CONNECTOR_SUPPORT.md`
- Modify: `docs/PRIVACY_OPERATIONS.md`
- Modify: `infra/chrome/vera-openclaw-extension/store/listing.json`
- Modify: `infra/chrome/vera-openclaw-extension/store/reviewer-instructions.md`
- Modify: `infra/chrome/vera-openclaw-extension/store/privacy-practices.md`
- Modify: `infra/chrome/vera-openclaw-extension/release-lock.json`
- Modify: `packages/db/src/postgres/ephemeral-cleanup.ts`
- Modify: `packages/db/src/postgres/ephemeral-cleanup.integration.test.ts`

**Interfaces:**
- Consumes: all completed behavior from Tasks 1–6.
- Produces: static regression gates, Store/package metadata, bounded expiry cleanup, and operator instructions.

- [ ] **Step 1: Write failing verifier and cleanup tests**

Require the verifiers to reject raw-ticket columns, relay-secret web resolution, credentials in page messages, additional Chrome permissions/routes, enrollment frames forwarded to OpenClaw, missing checkpoint-first authentication, ticket lifetimes over 60 seconds, missing exact feature flags, and extension/package version drift.

Cleanup test input:

```ts
const result = await cleanupEphemeralState({
  now: "2026-08-14T14:00:00.000Z",
  enrollmentTicketLimit: 100,
  repositories
});
expect(result.expiredBrowserEnrollmentTickets).toBe(2);
expect(repositories.enrollments.expireBatch).toHaveBeenCalledWith({
  now: "2026-08-14T14:00:00.000Z",
  limit: 100
});
```

- [ ] **Step 2: Run verifiers and cleanup tests and verify they fail**

Run: `pnpm vitest run --project unit scripts/verify-browser-assignment-boundaries.unit.test.ts scripts/verify-remote-extension-config.unit.test.ts scripts/verify-vera-openclaw-extension.unit.test.ts scripts/package-vera-browser-connector.unit.test.ts && pnpm vitest run --project postgres-integration packages/db/src/postgres/ephemeral-cleanup.integration.test.ts`

Expected: FAIL because the new boundaries and cleanup count are not enforced.

- [ ] **Step 3: Implement static boundary assertions and bounded expiry**

Add closed-string and structural assertions for the exact routes, protocol, flags, storage keys, permissions, checkpoint-before-body order, no-secret web boundary, and immutable rollback digest. Add one `expireBatch` call to the existing bounded cleanup transaction without deleting consumed ticket evidence or any listing data.

- [ ] **Step 4: Update Store and operator documentation**

Describe version 2.2.0 as private trusted-tester software. Replace pairing-string instructions with `Connect this browser`, state that connection persists on one Chrome profile, retain explicit tab sharing and manual blockers, and document device replacement/revocation. Keep deferred publishing and do not add a public Store URL before publication.

- [ ] **Step 5: Package and verify exact extension bytes**

Run: `pnpm verify:vera-openclaw-extension && pnpm verify:vera-connector-store && pnpm package:vera-browser-connector -- --output-dir /private/tmp/vera-browser-connector-2.2.0`

Expected: PASS; the ZIP contains only allowlisted version 2.2.0 files, its adjacent SHA-256 verifies, and permissions are unchanged.

- [ ] **Step 6: Run security verifiers and cleanup tests**

Run: `pnpm verify:browser-boundaries && pnpm verify:browser-assignments && pnpm verify:remote-extension-config && pnpm verify:web-mutation-boundaries && pnpm vitest run --project postgres-integration packages/db/src/postgres/ephemeral-cleanup.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit verification and operations changes**

```bash
git add scripts docs/BROWSER_BETA_OPERATIONS.md docs/CHROME_WEB_STORE_RELEASE.md docs/BROWSER_CONNECTOR_SUPPORT.md docs/PRIVACY_OPERATIONS.md infra/chrome/vera-openclaw-extension/store infra/chrome/vera-openclaw-extension/release-lock.json packages/db/src/postgres/ephemeral-cleanup.ts packages/db/src/postgres/ephemeral-cleanup.integration.test.ts
git commit -m "test: enforce browser enrollment boundaries"
```

### Task 8: Complete repository validation and prepare the single PR

**Files:**
- Modify only if validation exposes a scoped defect: files already listed in Tasks 1–7.
- Evidence under gitignored path: `release-evidence/private/browser-enrollment-20260814/`

**Interfaces:**
- Consumes: the entire branch implementation.
- Produces: a reviewable branch, one final PR, and secret-free local evidence; no production activation.

- [ ] **Step 1: Inspect the complete diff for scope and secrets**

Run:

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short
rg -n "OPENCLAW_EXTENSION_PAIRING_SEED|openclaw-extension-token\.|Bearer [A-Za-z0-9_-]{16,}|browser-extension-relay\.secret" --glob '!docs/superpowers/**' --glob '!**/*.unit.test.ts' --glob '!**/*.integration.test.ts' .
```

Expected: no whitespace errors, no unrelated files, no credential values, and only documented test literals.

- [ ] **Step 2: Run focused tests for all changed subsystems**

Run: `pnpm vitest run --project unit packages/domain/src/browser-connector-enrollment.unit.test.ts packages/domain/src/browser-extension-readiness.unit.test.ts infra/chrome/vera-openclaw-extension infra/maritime/openclaw/remote-extension-enrollment.unit.test.ts infra/maritime/openclaw/remote-extension-route-filter.unit.test.ts apps/web/lib/browser-connector-enrollment-service.unit.test.ts apps/web/app/settings/integrations/browser-agent/browser-enrollment-client.unit.test.ts apps/web/app/api/internal/browser-connector/enrollment/checkpoint/route.unit.test.ts scripts/verify-browser-assignment-boundaries.unit.test.ts scripts/verify-remote-extension-config.unit.test.ts scripts/verify-vera-openclaw-extension.unit.test.ts`

Expected: PASS.

- [ ] **Step 3: Run hosted integration tests**

Run: `pnpm vitest run --project postgres-integration packages/db/src/postgres/browser-connector-enrollment-repository.integration.test.ts packages/db/src/postgres/ephemeral-cleanup.integration.test.ts packages/db/src/postgres/migrations.integration.test.ts && pnpm vitest run --project integration apps/web/app/api/settings/integrations/browser-agent/enrollment/route.integration.test.ts apps/web/app/api/settings/integrations/browser-agent/assignment/routes.integration.test.ts`

Expected: PASS with temporary schemas and no production writes.

- [ ] **Step 4: Run formatting, lint, typecheck, build, and all security verifiers**

Run: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm verify:browser-boundaries && pnpm verify:browser-assignments && pnpm verify:remote-extension-config && pnpm verify:vera-openclaw-extension && pnpm verify:vera-connector-store && pnpm verify:gateway-runtime-supply-chain && pnpm verify:web-mutation-boundaries`

Expected: every command exits zero.

- [ ] **Step 5: Run the full automated suite once**

Run: `pnpm test`

Expected: unit, integration, and Playwright projects pass with no external browser action or live consumer-site requirement.

- [ ] **Step 6: Record secret-free pre-release evidence**

Record commit, migration ID, extension version and ZIP SHA-256, verifier results, test counts, unchanged permissions, unchanged public Gateway path, rollback Gateway digest, and forbidden-action test result. Do not record tickets, installation IDs, credentials, tester emails, cookies, tabs, source page content, or infrastructure tokens.

- [ ] **Step 7: Push one branch and open one PR**

```bash
git push -u origin codex/one-click-browser-enrollment
gh pr create --base main --head codex/one-click-browser-enrollment --title "feat: add one-click browser connector enrollment" --body $'## Summary\n- add authenticated one-click Browser Connector enrollment\n- preserve explicit single-tab sharing and revocation\n- add bounded Gateway ticket exchange and security verification\n\n## Validation\n- focused unit and PostgreSQL integration tests\n- lint, typecheck, build, security verifiers\n- full pnpm test'
```

Expected: one PR whose checks include full CI and the Gateway release workflow remains publication-gated.

- [ ] **Step 8: Stop before production publication**

Do not publish the new Gateway image, submit or publish Chrome Web Store version 2.2.0, enable enrollment, provision a tester, alter the retained founder Gateway, or migrate production until PR review is green and the separate privacy, support-mailbox, Store, tester-cost, and live-acceptance gates have explicit evidence.

### Task 9: Post-merge controlled release and live acceptance

**Files:**
- Private evidence only: `release-evidence/private/browser-enrollment-20260814/`
- No source edits unless a separately reviewed defect is found.

**Interfaces:**
- Consumes: merged green commit and all external approvals.
- Produces: one privately published trusted-tester build and one isolated accepted tester, or a fail-closed no-go report.

- [ ] **Step 1: Recheck external activation gates**

Verify support mailbox round-trip, authenticated export/deletion rehearsal, private Store item approval, exact per-tester infrastructure cost approval, database backup and counts, zero active browser runs, production readiness, and immutable rollback artifacts. If any item is absent, keep every enrollment/browser flag disabled and record `no_go`.

- [ ] **Step 2: Build and attest the new Gateway image from the merged commit**

Use the existing Gateway release workflow once. Verify the exact digest, Cosign signature, SBOM, provenance, pinned runtime, and zero HIGH/CRITICAL vulnerabilities. Do not replace or delete either accepted rollback image.

- [ ] **Step 3: Submit and privately publish extension 2.2.0**

Upload the exact verified ZIP, retain `Private — trusted testers` and deferred publishing, add only the explicitly approved tester account, and record only item ID, version, package digest, visibility, review state, and timestamps.

- [ ] **Step 4: Provision one isolated tester assignment**

Create dedicated Gateway/checkpoint containers, Maritime agent, node/profile, relay/checkpoint/signing credentials, and active assignment. Configure the exact enrollment checkpoint and public Gateway origin. Preserve PostgreSQL data and keep browser jobs disabled.

- [ ] **Step 5: Run one-click live acceptance**

Install from the private Store in a clean Chrome profile, sign into Vera, click Connect once, restart Chrome, prove automatic reconnect, prove zero shared tabs, explicitly prepare/share one tab, complete one bounded real listing import, unshare, prove `no_shared_tab`, revoke, and verify zero connections, clipboard bytes, and forbidden actions.

- [ ] **Step 6: Decide record readiness**

Enable only the accepted tester if every check passed. Otherwise disable enrollment and browser routing, rotate the failed credentials, restore the accepted Gateway rollback image, preserve PostgreSQL, and report the exact typed no-go reason.
