# Zillow Section-Scoped Room Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bounded Zillow adapter select the saved bedroom and bathroom values from Zillow's current bare numeric semantic controls without allowing unscoped numeric clicks.

**Architecture:** Add one semantic-snapshot helper that returns a reviewed control only when its reference occurs uniquely between exact section markers. Keep the existing long-form control lookup first, then use the section-scoped helper for exact saved values such as `2+` and `1.5+`.

**Tech Stack:** Node.js ESM, TypeScript/Vitest tests, OpenClaw semantic snapshots, pnpm.

## Global Constraints

- Do not change `vera_zillow_rental_research_v1` input or output schemas.
- Do not add CSS selectors, coordinates, arbitrary JavaScript, generic numeric controls, or new browser actions.
- Zero, duplicate, unbounded, or mismatched section candidates must return `manual_action_required` with `layout_changed`.
- Preserve all founder, policy, kill-switch, consent-tab, hostname, cancellation, time, result, detail, and expansion checks.
- Preserve the forbidden Contact, Apply, Tour, Message, Phone, Email, payment, upload, download, login, and CAPTCHA boundaries.
- Keep the Milestone 13A image and candidate 5 immutable.
- Publish at most the one explicitly authorized sixth candidate after green hosted CI.

---

### Task 1: Add current Zillow room-control regression coverage

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

**Interfaces:**
- Consumes: `researchZillowRentals(input, dependencies)` and the existing mocked `/tabs`, `/snapshot`, `/act`, and checkpoint boundaries.
- Produces: a current-layout fixture with duplicate bare numeric names across exact `Bedrooms` and `Bathrooms` sections.

- [ ] **Step 1: Extend the Beds/Baths fixture with the observed semantic shape**

Add a `currentRoomControls` option to `snapshotForState` and `happyFetch`. When the stage is
`beds`, the current fixture must include this bounded shape and matching refs:

```ts
snapshot: [
  '- text: Bedrooms',
  '- button "Any" [ref=e60]',
  '- button "1+" [ref=e61]',
  '- button "2+" [ref=e62]',
  '- button "3+" [ref=e63]',
  '- checkbox "Use exact match" [ref=e64]',
  '- text: Bathrooms',
  '- button "Any" [ref=e70]',
  '- button "1+" [ref=e71]',
  '- button "1.5+" [ref=e72]',
  '- button "2+" [ref=e73]',
  '- button "See 739 rentals available" [ref=e5]'
].join("\n"),
refs: {
  e60: { role: "button", name: "Any" },
  e61: { role: "button", name: "1+" },
  e62: { role: "button", name: "2+" },
  e63: { role: "button", name: "3+" },
  e64: { role: "checkbox", name: "Use exact match" },
  e70: { role: "button", name: "Any" },
  e71: { role: "button", name: "1+" },
  e72: { role: "button", name: "1.5+" },
  e73: { role: "button", name: "2+" },
  e5: { role: "button", name: "See 739 rentals available" }
}
```

- [ ] **Step 2: Write the failing current-layout success test**

```ts
it("selects bare room values only inside their reviewed Zillow sections", async () => {
  const { calls, fetchImplementation } = happyFetch({ currentRoomControls: true });
  const result = await researchZillowRentals(input, {
    fetch: fetchImplementation,
    now: () => new Date("2026-08-01T06:00:00.000Z"),
    monotonicNow: () => 1_000
  });

  expect(result.state).toBe("completed");
  const actions = calls
    .filter((call) => new URL(call.url).pathname === "/act")
    .map((call) => call.body);
  expect(actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "click", ref: "e62" }),
      expect.objectContaining({ kind: "click", ref: "e71" })
    ])
  );
  expect(JSON.stringify(actions)).not.toMatch(
    /Contact|Apply|Tour|Message|Phone|Email|payment|upload|download/iu
  );
});
```

- [ ] **Step 3: Add fail-closed tests**

Parameterize the current fixture so one case omits `Bathrooms` and another duplicates `e62` inside
the bedroom section. Each result must match:

```ts
expect(result).toMatchObject({
  state: "manual_action_required",
  pageState: "layout_changed",
  manualAction: "layout_changed",
  listings: []
});
```

Assert that neither case sends an `/act` body referencing the ambiguous or unscoped numeric ref.

- [ ] **Step 4: Run the focused test and confirm RED**

Run:

```bash
pnpm exec vitest run --project unit infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
```

Expected: the current-layout success test fails with `manual_action_required/layout_changed`; the
existing tests remain otherwise unchanged.

### Task 2: Implement unique section-scoped semantic lookup

**Files:**
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/zillow-snapshot.mjs`
- Modify: `infra/maritime/openclaw/vera-zillow-rental-research/index.mjs`
- Test: `infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts`

**Interfaces:**
- Produces: `findReviewedControlInSection(document, input)`, returning one frozen parsed ref or `null`.
- Consumes: hard-coded roles, exact saved-value patterns, and exact section marker patterns; no model-provided selectors or names.

- [ ] **Step 1: Parse only semantic line names and references**

Add these private helpers to `zillow-snapshot.mjs`:

```js
function semanticLine(line) {
  const body = line.trim().replace(/^-\s+/u, "");
  const quoted = body.match(/^[a-z]+\s+"([^"]{1,300})"/u);
  const labeled = body.match(/^(?:text|generic|paragraph):\s*(.{1,300})$/u);
  const name = cleanObservedText(quoted?.[1] ?? labeled?.[1] ?? "", 300);
  const ref = line.match(/\[ref=((?:e\d+|\d{1,9}))\]/iu)?.[1] ?? null;
  return { name, ref };
}

function uniqueMarkerIndex(lines, patterns, after = -1) {
  const matches = lines
    .map((line, index) => ({ index, name: semanticLine(line).name }))
    .filter(({ index, name }) => index > after && patterns.some((pattern) => pattern.test(name)));
  return matches.length === 1 ? matches[0].index : -1;
}
```

- [ ] **Step 2: Add the exported section-scoped finder**

```js
export function findReviewedControlInSection(document, input) {
  const lines = document.snapshot.split(/\r?\n/u);
  const start = uniqueMarkerIndex(lines, input.startNames);
  const end = uniqueMarkerIndex(lines, input.endNames, start);
  if (start < 0 || end <= start) return null;
  const allowedRefs = new Set(
    lines
      .slice(start + 1, end)
      .map((line) => semanticLine(line).ref)
      .filter((ref) => ref !== null)
  );
  const roles = new Set(input.roles);
  const candidates = document.refs.filter(
    (entry) =>
      allowedRefs.has(entry.ref) &&
      roles.has(entry.role) &&
      input.names.some((pattern) => pattern.test(entry.name)) &&
      !FORBIDDEN_CONTROL.test(entry.name)
  );
  return candidates.length === 1 ? candidates[0] : null;
}
```

Do not return the first candidate when multiple candidates match.

- [ ] **Step 3: Use the helper only as the current-layout fallback**

Import `findReviewedControlInSection` in `index.mjs`. Keep each existing long-form lookup first.
For bedrooms, use exact markers `^Bedrooms$` to `^Bathrooms$`. For bathrooms, use exact markers
`^Bathrooms$` to the existing reviewed apply names. Match only the exact saved numeric value:

```js
const bareRoomValue = (value) =>
  new RegExp(`^${String(value).replace(".", "\\.")}\\+$`, "u");

const bedrooms =
  findReviewedControl(document, longFormBedroomInput) ??
  findReviewedControlInSection(document, {
    roles: ["button", "radio"],
    names: [bareRoomValue(state.input.profile.minimumBedrooms)],
    startNames: [/^Bedrooms$/iu],
    endNames: [/^Bathrooms$/iu]
  });

const bathrooms =
  findReviewedControl(document, longFormBathroomInput) ??
  findReviewedControlInSection(document, {
    roles: ["button", "radio"],
    names: [bareRoomValue(state.input.profile.minimumBathrooms)],
    startNames: [/^Bathrooms$/iu],
    endNames: [/^Done$/iu, /^Save$/iu, /^See [\d,]+ rentals? available$/iu]
  });
```

If either required lookup returns `null`, retain the existing `layoutChanged()` failure.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run the same focused Vitest command from Task 1.

Expected: all tests in `index.unit.test.ts` pass, including the current-layout and fail-closed cases.

- [ ] **Step 5: Format and inspect the focused diff**

Run:

```bash
pnpm exec prettier --write \
  infra/maritime/openclaw/vera-zillow-rental-research/index.mjs \
  infra/maritime/openclaw/vera-zillow-rental-research/zillow-snapshot.mjs \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts
git diff --check
git diff --stat
```

Expected: only the two Gateway implementation files and focused unit test change.

### Task 3: Verify, commit, and review the focused repair

**Files:**
- Modify: the three Task 2 files only.
- Preserve: `docs/superpowers/specs/2026-08-01-zillow-section-scoped-room-controls-design.md`.

**Interfaces:**
- Consumes: the section-scoped finder and current-layout regression fixture.
- Produces: a reviewable repair commit with unchanged public contracts.

- [ ] **Step 1: Run affected tests and release verifiers**

```bash
pnpm exec vitest run --project unit \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts \
  infra/maritime/openclaw/vera-zillow-rental-research/restart.unit.test.ts \
  packages/domain/src/zillow-browser-research.unit.test.ts \
  packages/connectors/src/maritime-zillow-research-client.unit.test.ts \
  packages/connectors/src/zillow-research-import.unit.test.ts \
  packages/policy/src/zillow-research-policy.unit.test.ts \
  apps/web/lib/zillow-research-checkpoint-service.unit.test.ts
pnpm lint
pnpm typecheck
pnpm verify:gateway-runtime-supply-chain
pnpm verify:remote-extension-config
pnpm verify:gateway-release-workflow
```

Expected: every command exits zero, no forbidden action test regresses, and the Gateway release
workflow still requires exact-source signed/attested evidence with zero HIGH/CRITICAL findings.

- [ ] **Step 2: Review the diff for boundary expansion and secrets**

```bash
git diff --check
git diff --name-only origin/main...HEAD
git status --short
```

Confirm there are no secret values, selectors, coordinates, arbitrary JavaScript, generic action
sequences, new dependencies, new routes, or unrelated file changes.

- [ ] **Step 3: Commit the repair**

```bash
git add \
  infra/maritime/openclaw/vera-zillow-rental-research/index.mjs \
  infra/maritime/openclaw/vera-zillow-rental-research/zillow-snapshot.mjs \
  infra/maritime/openclaw/vera-zillow-rental-research/index.unit.test.ts \
  docs/superpowers/plans/2026-08-01-zillow-section-scoped-room-controls.md
git commit -m "fix: scope Zillow room controls by section"
```

### Task 4: PR, candidate 6, and live acceptance

**Files:**
- No new product files.
- Private evidence remains gitignored under `release-evidence/private/m13b-zillow-20260731-01/`.

**Interfaces:**
- Consumes: the focused repair commit and existing immutable release workflow.
- Produces: one signed candidate-6 digest and a completed live Vera acceptance bundle.

- [ ] **Step 1: Push the focused branch and open a PR**

Push `codex/browser-research-zillow-bedroom-controls`, open a ready PR with the test/gate summary,
and wait for every hosted check to pass before merge.

- [ ] **Step 2: Publish exactly one sixth immutable candidate**

Dispatch `.github/workflows/release-openclaw-gateway.yml` from merged `main` using the exact full
merge SHA. Verify the immutable digest, source binding, signature, SBOM attestation, provenance
attestation, and zero HIGH/CRITICAL scan. Remove the temporary repository secret and revoke the
temporary package-publish token immediately afterward without exposing its value.

- [ ] **Step 3: Deploy and rerun the real Boston acceptance**

Rotate only the disposable Gateway image/source identifiers, verify UID/GID `1000:1000`, VPC-only
binding, route isolation, restart reconciliation, audits, and public TLS/WSS. Ask the founder to
explicitly reshare exactly one logged-in Zillow rental tab after restart. Run the one bounded
Boston search and require at least one observed Zillow listing to pass through `RawListing`,
normalization, provenance, dedupe, scoring, and inbox presentation with zero forbidden actions.

- [ ] **Step 4: Prove revocation and clean up**

Ask the founder to unshare the tab, verify the next browser operation returns `no_shared_tab`,
revoke pairing, verify zero shared tabs, remove all disposable DigitalOcean/Heroku resources and
temporary credentials, and record the final evidence hashes and limitations.
