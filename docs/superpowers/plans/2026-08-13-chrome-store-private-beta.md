# Chrome Web Store Private Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the proven unpacked connector into an accurately disclosed, deterministic Chrome Web Store private-beta package without changing its one-tab browser authority or publishing it to unapproved users.

**Architecture:** Keep the reviewed Manifest V3 runtime and exact five permissions, while correcting the product origin, consent copy, icon metadata, privacy/support surfaces, and release verification. Generate one deterministic ZIP from an explicit allowlist and submit it as Private — trusted testers with deferred publishing. Render a Store installation link only after the reviewed item is actually published privately.

**Tech Stack:** Chrome Manifest V3, JavaScript modules, TypeScript release tooling, Vitest 4.1.10, Sharp 0.35.3, Playwright 1.61.1, deterministic `zip -X`, Next.js marketing/product apps, Chrome Web Store Developer Dashboard.

## Global Constraints

- Work only in `/private/tmp/vera-m13b-pr75-live-20260811` on branch `codex/private-beta-launch-polish`.
- The Store item name is exactly **Vera Browser Connector BETA** and version is monotonically increased from `2.0.3` to `2.1.0`.
- The description begins exactly: `THIS EXTENSION IS FOR BETA TESTING.`
- Permissions remain exactly `debugger`, `tabs`, `tabGroups`, `storage`, and `alarms`.
- Do not add `host_permissions`, `optional_host_permissions`, `chrome.scripting`, cookies, downloads, history, identity, web request, externally connectable, or web-accessible resources.
- The readiness bridge matches only `http://127.0.0.1:3000/*`, `http://localhost:3000/*`, and `https://app.verahousing.app/*`.
- Remove `https://verahousing.app/*`, `https://www.verahousing.app/*`, and `https://vera-ai-housing.vercel.app/*` from extension readiness authority.
- Store installation does not grant Vera product access, Gateway pairing, browser activation, or beta membership.
- Pairing remains manual and concierge-only. No credential is embedded in source, ZIP, Store metadata, images, documentation, logs, or web pages.
- The prominent popup disclosure appears before the share action and states that the exact tab URL and observed page content required for housing research may be processed.
- The extension does not contain an LLM, search autonomously, type credentials, solve blockers, contact anyone, or perform background browser polling.
- Contact, Apply, Tour, Reply, Message, Email, Phone, payment, upload, and download actions remain forbidden.
- Unshare immediately removes future tab access; unpair removes local relay credentials and closes the connection.
- The Store distribution is **Private — trusted testers** with deferred publishing; private items still require policy review.
- Before the item is privately published, public pages render only **Join private beta** and no Store URL.
- Assets use the real extension and Vera product, not speculative or rejected concept UI.
- Do not build, publish, restart, or modify the signed OpenClaw Gateway image.
- Run focused checks while iterating and one full CI run only on the final combined PR.

## File Map

- Modify `infra/chrome/vera-openclaw-extension/manifest.json`: beta identity, version, icons, exact readiness origins.
- Modify `popup.html` and `popup.js`: prominent one-tab data disclosure, privacy/support links, affirmative share copy.
- Add `images/icon-16.png`, `icon-32.png`, `icon-48.png`, and `icon-128.png`.
- Add `assets/vera-connector-icon.svg`: reproducible icon source.
- Modify `release-lock.json`: lock name/version, manifest, runtime, and icon digest.
- Modify `scripts/verify-vera-openclaw-extension.ts`: verify Store-safe manifest and package inputs.
- Add `scripts/package-vera-browser-connector.ts` and unit tests: deterministic allowlisted ZIP and SHA-256.
- Add `infra/chrome/vera-openclaw-extension/store/listing.json`: source of truth for Store listing fields.
- Add Store privacy declarations, permission justifications, test instructions, and release checklist.
- Add actual `store/assets/screenshot-1.png` at 1280x800 and `small-promo.png` at 440x280.
- Add public marketing privacy/support routes and product onboarding state.
- Add `VERA_CHROME_STORE_RELEASE_STATUS` and `VERA_CHROME_STORE_ITEM_URL` to `.env.example`.
- Add `docs/CHROME_WEB_STORE_RELEASE.md`: dashboard submission, review, publication, rollback, and tester handling.

---

### Task 1: Lock the Store-safe manifest and reviewed origins

**Files:**
- Modify: `infra/chrome/vera-openclaw-extension/manifest.json`
- Modify: `scripts/verify-vera-openclaw-extension.ts`
- Create: `scripts/verify-vera-openclaw-extension.unit.test.ts`

**Interfaces:**
- Consumes: current extension source and reviewed OpenClaw upstream identity.
- Produces: `findVeraExtensionViolations(input): string[]` and a Store-safe version `2.1.0` manifest.

- [ ] **Step 1: Extract the verifier into failing mutation tests**

```ts
import { describe, expect, it } from "vitest";
import { findVeraExtensionViolations } from "./verify-vera-openclaw-extension.ts";

const manifest = {
  manifest_version: 3,
  name: "Vera Browser Connector BETA",
  version: "2.1.0",
  description: "THIS EXTENSION IS FOR BETA TESTING. Share one dedicated housing-search tab with an approved Vera Browser Gateway.",
  permissions: ["debugger", "tabs", "tabGroups", "storage", "alarms"],
  content_scripts: [{ matches: ["http://127.0.0.1:3000/*", "http://localhost:3000/*", "https://app.verahousing.app/*"], js: ["readiness-bridge.js"], run_at: "document_idle" }],
  background: { service_worker: "background.js", type: "module" },
  action: { default_title: "Vera Browser Connector BETA", default_popup: "popup.html", default_icon: { 16: "images/icon-16.png", 32: "images/icon-32.png", 48: "images/icon-48.png", 128: "images/icon-128.png" } },
  icons: { 16: "images/icon-16.png", 32: "images/icon-32.png", 48: "images/icon-48.png", 128: "images/icon-128.png" },
  minimum_chrome_version: "125"
};
const clean = { manifest, runtime: "Prepare Vera Search tab openclaw-extension-relay openclaw-extension-token. browser_extension_conflict about:blank https://www.zillow.com/homes/for_rent/", iconDimensions: new Map([["icon-16.png", [16, 16]], ["icon-32.png", [32, 32]], ["icon-48.png", [48, 48]], ["icon-128.png", [128, 128]]]) };

describe("Vera Store extension", () => {
  it("accepts the reviewed Store boundary", () => expect(findVeraExtensionViolations(clean)).toEqual([]));
  it("rejects another readiness origin", () => expect(findVeraExtensionViolations({ ...clean, manifest: { ...manifest, content_scripts: [{ ...manifest.content_scripts[0], matches: [...manifest.content_scripts[0].matches, "https://verahousing.app/*"] }] } })).toContain("Readiness bridge origins are not exact."));
  it("rejects added browser authority", () => expect(findVeraExtensionViolations({ ...clean, manifest: { ...manifest, permissions: [...manifest.permissions, "scripting"] } })).toContain("Permissions are not exact."));
  it("rejects an incorrectly sized icon", () => expect(findVeraExtensionViolations({ ...clean, iconDimensions: new Map([["icon-16.png", [32, 32]]]) })).toContain("Extension icons are missing or incorrectly sized."));
});
```

- [ ] **Step 2: Run the unit test and verify the current verifier has no exported function**

Run: `pnpm exec vitest run --project unit scripts/verify-vera-openclaw-extension.unit.test.ts`

Expected: FAIL because `findVeraExtensionViolations` is not exported.

- [ ] **Step 3: Refactor the verifier and update the manifest**

Make `findVeraExtensionViolations` pure and retain the executable wrapper. Verify exact name, version, description prefix, permissions, content-script matches, icons, action icons, one content script, `run_at: document_idle`, no prohibited manifest keys, no prohibited runtime patterns, exact prepared start URL occurrence, and reviewed upstream identity.

Set the manifest to:

```json
{
  "manifest_version": 3,
  "name": "Vera Browser Connector BETA",
  "version": "2.1.0",
  "description": "THIS EXTENSION IS FOR BETA TESTING. Share one dedicated housing-search tab with an approved Vera Browser Gateway.",
  "permissions": ["debugger", "tabs", "tabGroups", "storage", "alarms"],
  "content_scripts": [{
    "matches": ["http://127.0.0.1:3000/*", "http://localhost:3000/*", "https://app.verahousing.app/*"],
    "js": ["readiness-bridge.js"],
    "run_at": "document_idle"
  }],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": {
    "default_title": "Vera Browser Connector BETA",
    "default_popup": "popup.html",
    "default_icon": { "16": "images/icon-16.png", "32": "images/icon-32.png", "48": "images/icon-48.png", "128": "images/icon-128.png" }
  },
  "icons": { "16": "images/icon-16.png", "32": "images/icon-32.png", "48": "images/icon-48.png", "128": "images/icon-128.png" },
  "minimum_chrome_version": "125"
}
```

- [ ] **Step 4: Run verifier unit tests**

Run: `pnpm exec vitest run --project unit scripts/verify-vera-openclaw-extension.unit.test.ts`

Expected: 4 tests PASS; the executable verifier still fails until icons and release lock are updated in Tasks 2 and 3.

- [ ] **Step 5: Commit the manifest boundary**

```sh
git add infra/chrome/vera-openclaw-extension/manifest.json scripts/verify-vera-openclaw-extension.ts scripts/verify-vera-openclaw-extension.unit.test.ts
git commit -m "feat: define Vera connector beta manifest"
```

---

### Task 2: Put prominent consent and revocation guidance in the popup

**Files:**
- Modify: `infra/chrome/vera-openclaw-extension/popup.html`
- Modify: `infra/chrome/vera-openclaw-extension/popup.js`
- Create: `infra/chrome/vera-openclaw-extension/modules/popup-copy.js`
- Create: `infra/chrome/vera-openclaw-extension/modules/popup-copy.d.ts`
- Create: `infra/chrome/vera-openclaw-extension/modules/popup-copy.unit.test.ts`
- Modify: `infra/chrome/vera-openclaw-extension/background.unit.test.ts`

**Interfaces:**
- Consumes: existing `pair`, `prepareSearchTab`, `toggleShareTab`, `isTabShared`, and `unpair` messages.
- Produces: `CONSENT_DISCLOSURE`, `shareButtonLabel(shared)`, and user-visible privacy/support navigation.

- [ ] **Step 1: Write failing copy and action tests**

```ts
import { describe, expect, it } from "vitest";
import { CONSENT_DISCLOSURE, shareButtonLabel } from "./popup-copy.js";

describe("connector consent copy", () => {
  it("describes the exact processed data before sharing", () => {
    expect(CONSENT_DISCLOSURE).toContain("exactly one tab");
    expect(CONSENT_DISCLOSURE).toContain("tab URL");
    expect(CONSENT_DISCLOSURE).toContain("observed page content");
    expect(CONSENT_DISCLOSURE).toContain("cookies, saved passwords, browser storage, and authenticated headers are excluded");
  });

  it("makes the share action affirmative and revocation explicit", () => {
    expect(shareButtonLabel(false)).toBe("Share this tab with Vera");
    expect(shareButtonLabel(true)).toBe("Stop sharing this tab");
  });
});
```

- [ ] **Step 2: Run the popup test and confirm exports are absent**

Run: `pnpm exec vitest run --project unit infra/chrome/vera-openclaw-extension/modules/popup-copy.unit.test.ts`

Expected: FAIL because `modules/popup-copy.js` does not exist.

- [ ] **Step 3: Implement disclosure without adding authority**

Create `modules/popup-copy.js`:

```js
export const CONSENT_DISCLOSURE = "Share exactly one tab with Vera. While shared, the tab URL and observed page content needed for your housing research may be processed through your paired Vera Browser Gateway. Cookies, saved passwords, browser storage, and authenticated headers are excluded from listing output. Vera never clicks Contact, Apply, Tour, Reply, Message, Email, Phone, payment, upload, or download controls.";
export function shareButtonLabel(shared) {
  return shared ? "Stop sharing this tab" : "Share this tab with Vera";
}
```

Place the disclosure in a bordered `section` immediately above `shareButton`, with heading “Before you share”. Keep the button as the affirmative consent action. Add: “Unsharing stops future tab access. Unpairing also removes this device's relay credential.” Link to `https://verahousing.app/privacy/browser-connector` and `https://verahousing.app/support/browser-connector` with `target="_blank"` and `rel="noreferrer"`. Rename the heading to “Vera Browser Connector BETA”; retain prepared-tab-first ordering; use `shareButtonLabel` in refresh.

Import the pure copy module at the top of `popup.js`:

```js
import { CONSENT_DISCLOSURE, shareButtonLabel } from "./modules/popup-copy.js";
```

Set the disclosure element's `textContent` from `CONSENT_DISCLOSURE`. Add `popup-copy.d.ts` declaring both exports so the TypeScript test has no implicit module.

Do not change background message names or add another content script. Extend the existing unpair regression test to assert storage removal of exactly `relayUrl` and `token`, debugger detach, group removal, and socket closure.

- [ ] **Step 4: Run popup and background tests**

Run: `pnpm exec vitest run --project unit infra/chrome/vera-openclaw-extension/modules/popup-copy.unit.test.ts infra/chrome/vera-openclaw-extension/background.unit.test.ts infra/chrome/vera-openclaw-extension/modules/prepared-tab.unit.test.ts`

Expected: all tests PASS and forbidden runtime action behavior remains unchanged.

- [ ] **Step 5: Commit popup disclosure**

```sh
git add infra/chrome/vera-openclaw-extension/popup.html infra/chrome/vera-openclaw-extension/popup.js infra/chrome/vera-openclaw-extension/modules/popup-copy.js infra/chrome/vera-openclaw-extension/modules/popup-copy.d.ts infra/chrome/vera-openclaw-extension/modules/popup-copy.unit.test.ts infra/chrome/vera-openclaw-extension/background.unit.test.ts
git commit -m "feat: add connector sharing disclosure"
```

---

### Task 3: Generate and lock Store icon assets

**Files:**
- Create: `infra/chrome/vera-openclaw-extension/assets/vera-connector-icon.svg`
- Create: `infra/chrome/vera-openclaw-extension/images/icon-16.png`
- Create: `infra/chrome/vera-openclaw-extension/images/icon-32.png`
- Create: `infra/chrome/vera-openclaw-extension/images/icon-48.png`
- Create: `infra/chrome/vera-openclaw-extension/images/icon-128.png`
- Create: `scripts/generate-vera-connector-assets.ts`
- Create: `scripts/generate-vera-connector-assets.unit.test.ts`
- Modify: `infra/chrome/vera-openclaw-extension/release-lock.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: current Vera coral/navy brand and Sharp already pinned in the root lockfile.
- Produces: `generateConnectorIcons(sourceSvg, outputDirectory)` and an `iconsSha256` release-lock field.

- [ ] **Step 1: Write failing deterministic icon tests**

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { generateConnectorIcons } from "./generate-vera-connector-assets.ts";

it("generates the four exact PNG sizes reproducibly", async () => {
  const first = await mkdtemp(join(tmpdir(), "vera-icons-a-"));
  const second = await mkdtemp(join(tmpdir(), "vera-icons-b-"));
  await generateConnectorIcons("infra/chrome/vera-openclaw-extension/assets/vera-connector-icon.svg", first);
  await generateConnectorIcons("infra/chrome/vera-openclaw-extension/assets/vera-connector-icon.svg", second);
  for (const size of [16, 32, 48, 128]) {
    const a = await readFile(join(first, `icon-${size}.png`));
    const b = await readFile(join(second, `icon-${size}.png`));
    expect(a).toEqual(b);
    expect(await sharp(a).metadata()).toMatchObject({ width: size, height: size, format: "png" });
  }
});
```

- [ ] **Step 2: Run the test and verify the generator is absent**

Run: `pnpm exec vitest run --project unit scripts/generate-vera-connector-assets.unit.test.ts`

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Add the brand source and deterministic generator**

Create a 128x128 transparent SVG with a 96x96 rounded navy field centered at 16,16, the current coral Vera `V` path centered inside it, and a 10px green readiness dot with a 2px light outline. Do not use gradients, text, Google/Chrome marks, or a new mascot.

Add root dev dependency `"sharp": "0.35.3"` and run `pnpm install --lockfile-only` so root release scripts import a declared dependency rather than relying on another workspace package.

Implement:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

export async function generateConnectorIcons(sourceSvg: string, outputDirectory: string): Promise<void> {
  const source = await readFile(sourceSvg);
  await mkdir(outputDirectory, { recursive: true });
  for (const size of [16, 32, 48, 128] as const) {
    const png = await sharp(source, { density: 384 }).resize(size, size, { fit: "fill" }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
    await writeFile(join(outputDirectory, `icon-${size}.png`), png);
  }
}
```

Run the executable to populate `images/`. Compute `iconsSha256` by concatenating `filename + newline + bytes` in ascending size order and add it to `release-lock.json`. Recompute `manifestSha256` and `runtimeSha256` only after Tasks 1–2 are final; retain the immutable upstream identity and set `vera.name`/`vera.version` to the manifest values.

- [ ] **Step 4: Run icon and full extension verification**

Run: `pnpm exec vitest run --project unit scripts/generate-vera-connector-assets.unit.test.ts && pnpm verify:vera-openclaw-extension`

Expected: icon test PASS and verifier prints `status: passed`, version `2.1.0`, three readiness origins, and exact five permissions.

- [ ] **Step 5: Commit locked assets**

```sh
git add infra/chrome/vera-openclaw-extension/assets infra/chrome/vera-openclaw-extension/images infra/chrome/vera-openclaw-extension/release-lock.json scripts/generate-vera-connector-assets.ts scripts/generate-vera-connector-assets.unit.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add locked Vera connector icons"
```

---

### Task 4: Publish accurate privacy and support surfaces

**Files:**
- Create: `apps/marketing/app/privacy/browser-connector/page.tsx`
- Create: `apps/marketing/app/support/browser-connector/page.tsx`
- Modify: `apps/marketing/app/page.tsx`
- Modify: `apps/marketing/app/landing-page.module.css`
- Modify: `apps/web/app/beta/page.tsx`
- Create: `apps/marketing/app/browser-connector-policy.unit.test.ts`
- Create: `docs/BROWSER_CONNECTOR_SUPPORT.md`

**Interfaces:**
- Consumes: the implemented extension behavior and existing privacy lifecycle runbook.
- Produces: canonical privacy URL, support URL, dedicated support mailbox contract, and source-verified Limited Use disclosure.

- [ ] **Step 1: Write a failing disclosure-source test**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

it("publishes every required browser connector disclosure", async () => {
  const privacy = await readFile(new URL("./privacy/browser-connector/page.tsx", import.meta.url), "utf8");
  for (const phrase of [
    "exactly one tab", "tab URL", "observed page content", "HTTPS and WSS",
    "do not sell", "advertising", "Chrome Web Store User Data Policy",
    "unpair", "deletion", "login, 2FA, CAPTCHA, consent"
  ]) expect(privacy).toContain(phrase);
  expect(privacy).toContain("support@verahousing.app");
});
```

- [ ] **Step 2: Run the test and verify the privacy route is absent**

Run: `pnpm exec vitest run --project unit apps/marketing/app/browser-connector-policy.unit.test.ts`

Expected: FAIL because the privacy page does not exist.

- [ ] **Step 3: Write the canonical disclosures and safe support flow**

The privacy page must identify the controller/contact; effective date; exact local storage (`relay endpoint`, scoped credential, group color); transmitted data (shared tab URL and observed page content needed for user-triggered housing research); imported listing facts and audit-safe metadata retained by Vera; HTTPS/WSS; excluded passwords, cookies, browser storage, authenticated headers, full-page screenshots, and unrelated browsing; essential infrastructure providers; no sale, advertising, creditworthiness use, or unrelated transfer; human inspection only with specific support consent, security necessity, law, or aggregated/anonymized operations; access/correction/deletion/unpair instructions; and this exact statement:

> Vera Browser Connector's use and transfer of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

The support page lists: verify approved Vera access; pair using only the concierge one-time value; prepare one dedicated tab; confirm Browser ready; handle login/2FA/CAPTCHA/consent manually; unshare; unpair. It says never send a password, cookie, pairing value, browser profile, raw page snapshot, or authenticated header. Use `support@verahousing.app`; add a release prerequisite in `docs/BROWSER_CONNECTOR_SUPPORT.md` to configure and successfully round-trip a message through that dedicated alias before Store submission.

Link both pages from the marketing footer; link privacy from `/beta`; do not add a Store install URL.

- [ ] **Step 4: Run policy, marketing, and demo builds**

Run: `pnpm exec vitest run --project unit apps/marketing/app/browser-connector-policy.unit.test.ts && pnpm --filter @vera/marketing run build && pnpm --filter @vera/web run build`

Expected: disclosure test PASS and both apps build.

- [ ] **Step 5: Commit privacy and support**

```sh
git add apps/marketing/app/privacy apps/marketing/app/support apps/marketing/app/browser-connector-policy.unit.test.ts apps/marketing/app/page.tsx apps/marketing/app/landing-page.module.css apps/web/app/beta/page.tsx docs/BROWSER_CONNECTOR_SUPPORT.md
git commit -m "feat: publish connector privacy and support"
```

---

### Task 5: Create real Store metadata and visual evidence

**Files:**
- Create: `infra/chrome/vera-openclaw-extension/store/listing.json`
- Create: `infra/chrome/vera-openclaw-extension/store/privacy-practices.md`
- Create: `infra/chrome/vera-openclaw-extension/store/permission-justifications.md`
- Create: `infra/chrome/vera-openclaw-extension/store/reviewer-instructions.md`
- Create: `infra/chrome/vera-openclaw-extension/store/release-checklist.md`
- Create: `infra/chrome/vera-openclaw-extension/store/assets/screenshot-1.png`
- Create: `infra/chrome/vera-openclaw-extension/store/assets/small-promo.png`
- Create: `scripts/verify-vera-connector-store-assets.ts`
- Create: `scripts/verify-vera-connector-store-assets.unit.test.ts`

**Interfaces:**
- Consumes: actual extension v2.1.0, deployed public demo, privacy page, and support page.
- Produces: `findStoreAssetViolations(input): string[]` and dashboard-ready metadata/assets.

- [ ] **Step 1: Write failing Store metadata tests**

```ts
it("requires accurate private-beta listing metadata", () => {
  expect(findStoreAssetViolations({ listing, assets })).toEqual([]);
});
it("rejects a listing that omits the beta prefix or overclaims automation", () => {
  expect(findStoreAssetViolations({ listing: { ...listing, detailedDescription: "Vera searches everything automatically." }, assets })).not.toEqual([]);
});
it("requires actual Store image dimensions", () => {
  expect(findStoreAssetViolations({ listing, assets: { icon: [128,128], screenshot: [1200,800], smallPromo: [440,280] } })).toContain("Store screenshot must be 1280x800 PNG.");
});
```

- [ ] **Step 2: Run the test and verify metadata tooling is absent**

Run: `pnpm exec vitest run --project unit scripts/verify-vera-connector-store-assets.unit.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Add exact listing content and permission justifications**

Create `listing.json`:

```json
{
  "schemaVersion": "vera-chrome-store-listing.v1",
  "language": "en",
  "name": "Vera Browser Connector BETA",
  "summary": "Share one dedicated housing-search tab with your approved Vera Browser Gateway.",
  "detailedDescription": "THIS EXTENSION IS FOR BETA TESTING. Vera Browser Connector lets an approved Vera tester explicitly share one dedicated housing-search tab with their paired Vera Browser Gateway. Vera may process the shared tab URL and observed housing-listing content only after the tester chooses Share this tab with Vera. The connector does not sign in, type credentials, solve CAPTCHA, contact anyone, submit applications, make payments, upload, download, or run background searches. Unsharing stops future tab access and unpairing removes the local relay credential.",
  "category": "Productivity",
  "homepageUrl": "https://verahousing.app",
  "privacyUrl": "https://verahousing.app/privacy/browser-connector",
  "supportUrl": "https://verahousing.app/support/browser-connector",
  "distribution": { "visibility": "private", "trustedTesters": true, "deferredPublishing": true, "regions": "all" }
}
```

Permission justifications must map each exact permission to its current runtime call sites: `debugger` for one explicitly shared tab's bounded CDP transport; `tabs` for identifying/preparing/revoking it; `tabGroups` for the visible dedicated group; `storage` for relay URL, scoped credential, and group color; `alarms` for bounded relay reconnection/readiness maintenance. Privacy practices declare website content and web browsing activity; secure WSS transfer; single purpose; no ads/sale/creditworthiness; and Limited Use certification.

Reviewer instructions state that pairing requires a time-boxed review Gateway supplied through the dashboard's credential field or direct reviewer coordination, never embedded in the ZIP. They give this sequence: install; open popup; enter review pairing value; click Prepare Vera Search tab; observe one grouped tab; click Stop sharing; observe zero shared tabs; click Unpair; observe disconnected. They do not ask the reviewer to contact, log in, or bypass a blocker.

- [ ] **Step 4: Capture real assets and run their verifier**

Load the unpacked, verified `infra/chrome/vera-openclaw-extension` in a clean Chrome profile. Pair it to a temporary review Gateway with no real marketplace account, prepare a sanitized page or public demo tab, and capture a full-bleed 1280x800 screenshot that visibly shows the actual popup disclosure, Browser ready state, one grouped tab, and Vera public demo. Redact no UI because no secret may be visible; if any credential or personal data appears, discard the capture and recreate it safely. Create the 440x280 promo by cropping the real Vera atlas/product composition and adding only the actual connector icon—no concept controls or Google branding.

Implement the verifier with Sharp metadata checks, PNG format checks, `listing.json` schema checks, exact URLs, exact private/deferred distribution, beta name/prefix, forbidden overclaim phrases (`automatically contacts`, `solves CAPTCHA`, `production-supported public`), required permission headings, and a source scan proving no pairing-pattern string appears in Store files.

Run: `pnpm exec vitest run --project unit scripts/verify-vera-connector-store-assets.unit.test.ts && pnpm tsx scripts/verify-vera-connector-store-assets.ts`

Expected: tests PASS and verifier reports icon 128x128, screenshot 1280x800, promo 440x280, private visibility, and zero metadata violations.

- [ ] **Step 5: Commit Store material**

```sh
git add infra/chrome/vera-openclaw-extension/store scripts/verify-vera-connector-store-assets.ts scripts/verify-vera-connector-store-assets.unit.test.ts
git commit -m "feat: add Vera connector Store material"
```

---

### Task 6: Package deterministically and gate install links

**Files:**
- Create: `scripts/package-vera-browser-connector.ts`
- Create: `scripts/package-vera-browser-connector.unit.test.ts`
- Create: `apps/marketing/lib/browser-connector-release.ts`
- Create: `apps/marketing/lib/browser-connector-release.unit.test.ts`
- Create: `apps/web/lib/browser-connector-release.ts`
- Create: `apps/web/lib/browser-connector-release.unit.test.ts`
- Modify: `apps/marketing/app/page.tsx`
- Modify: `apps/web/app/settings/integrations/browser-agent/page.tsx`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: verified extension directory and optional Store release environment.
- Produces: `packageVeraBrowserConnector`, SHA-256 evidence, and `approvedBrowserConnectorLink(environment): string | null`.

- [ ] **Step 1: Write failing package and release-link tests**

```ts
it("creates identical bytes and an allowlisted ZIP root", async () => {
  const first = await packageVeraBrowserConnector({ sourceDirectory, outputDirectory: firstDir });
  const second = await packageVeraBrowserConnector({ sourceDirectory, outputDirectory: secondDir });
  expect(first.sha256).toBe(second.sha256);
  expect(first.entries).toEqual([
    "background.js", "images/icon-128.png", "images/icon-16.png", "images/icon-32.png", "images/icon-48.png",
    "manifest.json", "modules/popup-copy.js", "modules/prepared-tab.js", "modules/relay-core.js", "popup.html", "popup.js", "readiness-bridge.js", "release-lock.json"
  ]);
  expect(first.entries.some((entry) => /test|store|\.ts$/.test(entry))).toBe(false);
});

it("returns a Store URL only after private publication", () => {
  const url = "https://chromewebstore.google.com/detail/vera-browser-connector/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  expect(approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "published", VERA_CHROME_STORE_ITEM_URL: url })).toBe(url);
  expect(approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "approved", VERA_CHROME_STORE_ITEM_URL: url })).toBeNull();
  expect(approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "published", VERA_CHROME_STORE_ITEM_URL: "https://example.com" })).toBeNull();
});
```

- [ ] **Step 2: Run focused tests and verify package/link helpers are absent**

Run: `pnpm exec vitest run --project unit scripts/package-vera-browser-connector.unit.test.ts apps/marketing/lib/browser-connector-release.unit.test.ts apps/web/lib/browser-connector-release.unit.test.ts`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement deterministic packaging and fail-closed URL rendering**

`packageVeraBrowserConnector` copies only the exact allowlist into a newly created temporary directory, rejects symlinks and any missing/non-regular file, sets every copied mtime to `2000-01-01T00:00:00.000Z`, invokes `/usr/bin/zip` with `-X -q` and sorted relative entries using `spawnSync` with `shell: false`, writes `vera-browser-connector-2.1.0.zip` to the explicit output directory, then returns the sorted entries, byte count, and SHA-256. The executable requires an output directory below `/private/tmp` or `release-evidence/private`; it never writes a package into the source directory.

Both app helpers accept only status `published` and URLs matching:

```ts
const STORE_ITEM = /^https:\/\/chromewebstore\.google\.com\/detail\/[a-z0-9-]+\/[a-p]{32}$/u;
```

Marketing renders “Install browser connector — approved testers” only when the helper returns a URL; otherwise it renders “Join private beta”. Product onboarding renders the link only for active beta members and otherwise says “Browser Connector is waiting for concierge onboarding.” No code generates a Store URL.

Add root scripts:

```json
{
  "package:vera-browser-connector": "tsx scripts/package-vera-browser-connector.ts",
  "verify:vera-connector-store": "tsx scripts/verify-vera-connector-store-assets.ts"
}
```

- [ ] **Step 4: Run the Store release gate**

Run: `pnpm verify:vera-openclaw-extension && pnpm verify:vera-connector-store && pnpm exec vitest run --project unit scripts/package-vera-browser-connector.unit.test.ts apps/marketing/lib/browser-connector-release.unit.test.ts apps/web/lib/browser-connector-release.unit.test.ts && pnpm package:vera-browser-connector -- --output /private/tmp/vera-browser-connector-2.1.0`

Expected: all verifiers/tests PASS; the output directory contains one ZIP and one `.sha256` file; listing the ZIP shows `manifest.json` at root and no test, Store, credential, TypeScript, source-map, or private evidence files.

- [ ] **Step 5: Commit packaging and link gate**

```sh
git add scripts/package-vera-browser-connector.ts scripts/package-vera-browser-connector.unit.test.ts apps/marketing/lib/browser-connector-release.ts apps/marketing/lib/browser-connector-release.unit.test.ts apps/web/lib/browser-connector-release.ts apps/web/lib/browser-connector-release.unit.test.ts apps/marketing/app/page.tsx apps/web/app/settings/integrations/browser-agent/page.tsx package.json .env.example
git commit -m "feat: package Vera connector private beta"
```

---

### Task 7: Submit privately, accept review, and publish to trusted testers

**Files:**
- Create: `docs/CHROME_WEB_STORE_RELEASE.md`
- Modify: `infra/chrome/vera-openclaw-extension/store/release-checklist.md`

**Interfaces:**
- Consumes: merged green commit, deterministic ZIP/SHA, working privacy/support URLs, verified support mailbox, and Chrome Web Store developer account.
- Produces: a private reviewed item, retained submission evidence, and a Store link shown only after private publication.

- [ ] **Step 1: Document exact dashboard values and irreversible boundaries**

The runbook must instruct the operator to resolve the developer account/publisher first; create a new item; upload the exact verified ZIP; copy listing fields from `listing.json`; upload the verified three assets; choose category Productivity; set homepage/privacy/support exact URLs; complete privacy declarations from `privacy-practices.md`; paste exact five permission justifications; add test instructions; set visibility Private; add only founder and explicit Google test accounts as trusted testers; select all regions; enable deferred publishing; and submit for review. It must say not to choose Unlisted or Public and not to paste a production pairing credential in metadata.

- [ ] **Step 2: Verify public prerequisites before submission**

Run:

```sh
curl -fsSI https://verahousing.app/privacy/browser-connector
curl -fsSI https://verahousing.app/support/browser-connector
pnpm verify:vera-openclaw-extension
pnpm verify:vera-connector-store
```

Expected: both pages return 200 over HTTPS and both verifiers pass. Send one test message to `support@verahousing.app` and verify the configured recipient can reply; record only success/failure, not message contents.

- [ ] **Step 3: Submit with deferred publishing and retain safe evidence**

Upload the ZIP whose SHA matches the private `.sha256` file. Store a private evidence record containing item ID, submitted version, ZIP SHA-256, submitted commit, publisher identity label, visibility `private`, tester count, deferred-publishing status, submission time, and review state. Do not save dashboard cookies, credential fields, pairing values, or tester emails in repository evidence.

- [ ] **Step 4: Publish only after approval and private-install smoke**

After approval, publish the item privately, install it with one listed Google tester in a clean Chrome profile, compare installed version `2.1.0`, verify the exact permissions shown, complete pair/prepare/share/unshare/unpair against a fresh time-boxed review Gateway, confirm zero shared tabs and no stored relay credential after unpair, then set `VERA_CHROME_STORE_RELEASE_STATUS=published` and the exact item URL in both Vercel and Heroku. Redeploy marketing/product only; do not deploy Gateway.

- [ ] **Step 5: Verify link and rollback behavior**

In a clean browser, confirm the marketing link appears only after publication and an unapproved Google account cannot install the private item. If review rejects the item, leave status unset, fix source/metadata, increment the extension version before resubmission when the ZIP changes, and keep “Join private beta”. If a published version is unsafe, unpublish it or replace it with a higher fixed version; never reuse version `2.1.0` for different bytes.

Commit the runbook before the final PR:

```sh
git add docs/CHROME_WEB_STORE_RELEASE.md infra/chrome/vera-openclaw-extension/store/release-checklist.md
git commit -m "docs: add Chrome Store private release runbook"
```
