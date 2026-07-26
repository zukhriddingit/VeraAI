# Founder Browser Remote Extension Connectivity Spike Implementation Plan

**Goal:** Add a founder-only, disabled-by-default read-only connectivity path from Vera through a
dedicated Maritime OpenClaw 2026.7.1 Gateway to one Chrome tab explicitly shared through the
official OpenClaw tab group.

**Architecture:** A separate browser-gateway Maritime identity receives a fixed snapshot task. A
dedicated OpenClaw configuration enables the official browser extension relay and one Vera plugin.
The plugin alone can call the loopback browser-control service, requires exactly one shared tab,
performs only GET requests, and deterministically minimizes the snapshot before any model or Vera
response sees it. Vera validates the minimized response and never receives the pairing credential,
raw CDP frames, target IDs, or a full snapshot.

**Tech stack:** TypeScript 6, Zod 4, Next.js 16, Vitest, OpenClaw 2026.7.1 plugin runtime, native
`fetch`, native Node WebSocket for opt-in live proxy checks.

## Constraints

- Keep the existing RentCast/Maritime agent path unchanged.
- Keep `founder_core` browser-disabled and keep `founder_browser_experimental` release-ineligible.
- Do not add source discovery, navigation, interaction, messaging, form submission, file transfer,
  applications, payments, scheduling, or marketplace login automation.
- Do not reuse the live-search Maritime key or agent ID.
- Do not deploy a gateway, change Maritime configuration, or persist live evidence from this plan.
- Keep live WSS and security-audit evidence external and private.

## Task 1: Approved ADR and dedicated Gateway configuration

**Files:**

- Create `docs/DECISIONS/0013-founder-browser-direct-remote-extension.md`
- Create `infra/maritime/openclaw/remote-extension.openclaw.json5`
- Modify `infra/maritime/OPENCLAW.md`
- Modify `infra/maritime/TOPOLOGY.md`
- Modify `infra/maritime/ENVIRONMENT.md`

- [ ] Record OpenClaw 2026.7.1 as the minimum release and pin the immutable image digest.
- [ ] Supersede the local-node topology for the new spike without deleting the legacy disabled
      path.
- [ ] Configure one extension profile, Control UI off, no nodes, no channels/cron/commands, and
      only the browser and Vera snapshot plugins.
- [ ] Keep the built-in browser tool denied and browser evaluation disabled.
- [ ] Document one Gateway/credential/state set per Vera user and the founder-only first slice.

## Task 2: Snapshot-only OpenClaw plugin

**Files:**

- Create `infra/maritime/openclaw/vera-read-shared-tab/openclaw.plugin.json`
- Create `infra/maritime/openclaw/vera-read-shared-tab/package.json`
- Create `infra/maritime/openclaw/vera-read-shared-tab/index.mjs`
- Create `scripts/verify-remote-extension-config.ts`
- Create `scripts/verify-remote-extension-config.unit.test.ts`
- Modify `package.json`

- [ ] Add an empty-input tool named `vera_read_shared_tab_snapshot`.
- [ ] Resolve only the loopback browser-control URL and server-only Gateway credential.
- [ ] GET the fixed `chrome` profile tabs and reject zero or multiple shared tabs.
- [ ] GET one bounded AI snapshot using the discovered target internally.
- [ ] Strip target IDs, refs, inputs, secrets, contact data, query strings, fragments, and profile
      paths.
- [ ] Return a closed bounded minimized object with hashes and safe counts.
- [ ] Verify no mutation verb, navigation action, URL input, target input, or arbitrary metadata
      exists in the plugin or configuration.

## Task 3: Strict Vera contracts and Maritime client

**Files:**

- Create `packages/domain/src/remote-extension-snapshot.ts`
- Create `packages/domain/src/remote-extension-snapshot.unit.test.ts`
- Modify `packages/domain/src/index.ts`
- Create `packages/connectors/src/maritime-remote-extension-client.ts`
- Create `packages/connectors/src/maritime-remote-extension-client.unit.test.ts`
- Modify `packages/connectors/src/index.ts`

- [ ] Define strict request confirmation, minimized snapshot, status, and response schemas.
- [ ] Add a browser-specific Maritime client with a fixed prompt, timeout, byte limit, and no
      retry/fallback.
- [ ] Parse only one JSON response matching the closed minimized schema.
- [ ] Reject wrong agent output, HTML, unknown fields, stale timestamps, oversized text, raw IDs,
      secrets, contacts, and unsafe URLs.
- [ ] Keep browser agent/key environment names separate from live-search names.

## Task 4: Founder-authenticated API and UI

**Files:**

- Create `apps/web/lib/remote-extension-snapshot-service.ts`
- Create `apps/web/lib/remote-extension-snapshot-service.unit.test.ts`
- Create `apps/web/app/api/integrations/remote-browser/snapshot/route.ts`
- Create `apps/web/app/api/integrations/remote-browser/snapshot/route.integration.test.ts`
- Create `apps/web/app/settings/integrations/remote-browser/page.tsx`
- Create `apps/web/app/settings/integrations/remote-browser/remote-browser-panel.tsx`
- Modify `apps/web/app/settings/integrations/page.tsx`
- Modify `apps/web/app/globals.css`

- [ ] Require an authenticated founder, exact server-side founder binding, the global browser kill
      switch to be off, the spike flag to be on, and explicit one-tab consent.
- [ ] Call only the dedicated browser-gateway client.
- [ ] Return safe error states and append no raw snapshot to logs or activity metadata.
- [ ] Render a connectivity-only panel that asks the founder to share exactly one tab and shows the
      minimized result.
- [ ] State clearly that Vera cannot navigate or interact in this spike.

## Task 5: Opt-in Maritime WSS acceptance probe

**Files:**

- Create `scripts/staging/remote-extension-proxy-smoke.ts`
- Create `scripts/staging/remote-extension-proxy-smoke.unit.test.ts`
- Modify `package.json`
- Modify `docs/FOUNDER_STAGING_EVIDENCE.md`

- [ ] Require an explicit live flag, WSS origin, and pairing secret from private environment only.
- [ ] Verify exact route, WSS upgrade, selected subprotocol, wrong-secret denial, bounded stability,
      close behavior, and secret-safe output.
- [ ] Keep payload and timeout observations bounded and report only safe states and hashes.
- [ ] Document the separate plain and deep OpenClaw audit commands.
- [ ] Make absent live proof a browser-experimental blocker, never a unit-test skip presented as
      success.

## Task 6: Release and policy regression protection

**Files:**

- Modify `scripts/verify-browser-boundaries.ts`
- Modify `scripts/verify-browser-boundaries.unit.test.ts`
- Modify `scripts/verify-release-documentation.ts`
- Modify `scripts/verify-release-documentation.unit.test.ts`
- Modify `docs/RELEASE_READINESS.md`
- Modify `docs/SOURCE_POLICY.md`
- Modify `docs/SECURITY_REVIEW.md`

- [ ] Verify the new path has no discovery or action vocabulary.
- [ ] Verify live-search environment variables and connector remain unchanged.
- [ ] Verify founder-core browser-disabled phase requirements remain unchanged.
- [ ] Verify browser experimental remains `no_go`.
- [ ] Document that source discovery cannot begin until all live ingress and audit evidence passes.

## Task 7: Validation

- [ ] Run the focused domain, connector, plugin/config, service, route, probe, and boundary tests.
- [ ] Run `pnpm verify:browser-boundaries`.
- [ ] Run `pnpm verify:remote-extension-config`.
- [ ] Run `pnpm verify:release-documentation`.
- [ ] Run `pnpm lint`, `pnpm typecheck`, and production builds.
- [ ] Run `pnpm format:check` and `git diff --check`.
- [ ] Review the diff for credentials, raw evidence, environment-specific IDs, generated artifacts,
      deployment actions, browser mutations, source discovery, live-search regressions, and release
      gate weakening.
