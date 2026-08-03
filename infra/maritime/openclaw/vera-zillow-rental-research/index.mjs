import { createHash } from "node:crypto";

import {
  MAX_DETAIL_PAGES,
  MAX_DURATION_MS,
  MAX_RESULT_EXPANSIONS,
  MAX_RESULTS,
  TOOL_NAME,
  VeraZillowResearchError,
  toolParameters,
  validateResearchInput,
  validateResearchOutput
} from "./contract.mjs";
import {
  assertSafeControl,
  extractDetailEvidence,
  extractResultCards,
  findReviewedControl,
  findReviewedControlInSection,
  parseZillowSnapshot,
  validateZillowUrl
} from "./zillow-snapshot.mjs";

const BROWSER_CONTROL_ORIGIN = "http://127.0.0.1:18792";
const BROWSER_PROFILE = "chrome";
const REQUEST_TIMEOUT_MS = 5_000;
const TABS_MAX_BYTES = 64 * 1024;
const SNAPSHOT_MAX_BYTES = 512 * 1024;
const ACTION_MAX_BYTES = 64 * 1024;
const CHECKPOINT_MAX_BYTES = 16 * 1024;
const SNAPSHOT_MAX_CHARS = 256 * 1024;
const MAX_BROWSER_ACTIONS = 80;
const MANUAL_ACTIONS = new Set([
  "login_required",
  "two_factor_required",
  "captcha_required",
  "consent_required",
  "blocked",
  "layout_changed",
  "browser_offline",
  "no_shared_tab",
  "multiple_shared_tabs",
  "shared_tab_changed",
  "cancelled"
]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeNow(dependencies) {
  const value = dependencies.now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new VeraZillowResearchError("invalid_research_clock");
  }
  return value.toISOString();
}

function checkDeadline(state, dependencies) {
  const elapsed = dependencies.monotonicNow() - state.startedMonotonic;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= MAX_DURATION_MS) {
    throw new VeraZillowResearchError("run_limit_exceeded");
  }
  if (state.browserActions >= MAX_BROWSER_ACTIONS) {
    throw new VeraZillowResearchError("run_limit_exceeded");
  }
  return Math.floor(elapsed);
}

async function readBoundedJson(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new VeraZillowResearchError("response_too_large");
  }
  if (!response.body) throw new VeraZillowResearchError("response_missing");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new VeraZillowResearchError("response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new VeraZillowResearchError("response_invalid_json");
  }
}

function remainingRequestTimeout(state, dependencies) {
  const remaining = MAX_DURATION_MS - (dependencies.monotonicNow() - state.startedMonotonic);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new VeraZillowResearchError("run_limit_exceeded");
  }
  return Math.max(250, Math.min(REQUEST_TIMEOUT_MS, Math.floor(remaining)));
}

async function browserGet(path, maxBytes, state, dependencies) {
  if (
    path !== `/tabs?profile=${BROWSER_PROFILE}` &&
    !path.startsWith("/snapshot?profile=chrome&")
  ) {
    throw new VeraZillowResearchError("browser_operation_not_allowed");
  }
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!gatewayToken) throw new VeraZillowResearchError("browser_control_auth_missing");
  let response;
  try {
    response = await dependencies.fetch(new URL(path, BROWSER_CONTROL_ORIGIN), {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${gatewayToken}`
      },
      signal: AbortSignal.timeout(remainingRequestTimeout(state, dependencies))
    });
  } catch {
    throw new VeraZillowResearchError("browser_offline", {
      manualAction: "browser_offline"
    });
  }
  if (!response.ok) {
    throw new VeraZillowResearchError("browser_offline", {
      manualAction: "browser_offline"
    });
  }
  return readBoundedJson(response, maxBytes);
}

async function browserPost(path, body, maxBytes, state, dependencies) {
  if (path !== "/navigate" && path !== "/act") {
    throw new VeraZillowResearchError("browser_operation_not_allowed");
  }
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!gatewayToken) throw new VeraZillowResearchError("browser_control_auth_missing");
  let response;
  try {
    response = await dependencies.fetch(new URL(path, BROWSER_CONTROL_ORIGIN), {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(remainingRequestTimeout(state, dependencies))
    });
  } catch {
    throw new VeraZillowResearchError("browser_offline", {
      manualAction: "browser_offline"
    });
  }
  if (!response.ok) {
    throw new VeraZillowResearchError("browser_action_failed");
  }
  return readBoundedJson(response, maxBytes);
}

function checkpointEndpoint() {
  const raw = process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL?.trim();
  if (!raw) throw new VeraZillowResearchError("checkpoint_not_configured");
  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new VeraZillowResearchError("checkpoint_not_configured");
  }
  const localDevelopment =
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost");
  if (
    (!localDevelopment && endpoint.protocol !== "https:") ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new VeraZillowResearchError("checkpoint_not_configured");
  }
  return endpoint;
}

async function authorizeAction(action, state, dependencies, input = {}) {
  const token = process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new VeraZillowResearchError("checkpoint_not_configured");
  }
  const elapsedMilliseconds = checkDeadline(state, dependencies);
  const body = {
    version: "1",
    veraRunId: state.input.veraRunId,
    action,
    startingTabReference: state.input.startingTabReference,
    activeTabReference: {
      kind: input.activeTabId === undefined ? state.input.startingTabReference.kind : "target_id",
      value: input.activeTabId ?? state.input.startingTabReference.value
    },
    sharedTabCount: input.sharedTabCount ?? state.lastSharedTabCount,
    hostname: input.hostname ?? "www.zillow.com",
    elapsedMilliseconds,
    resultCardsObserved: state.resultCardsObserved,
    detailPagesOpened: state.detailPagesOpened,
    resultPageExpansions: state.resultPageExpansions,
    observedReferenceHash: input.observedReferenceHash ?? null,
    requestedAt: safeNow(dependencies)
  };
  let response;
  try {
    const endpoint = checkpointEndpoint();
    response = await dependencies.fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: endpoint.origin
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(remainingRequestTimeout(state, dependencies))
    });
  } catch {
    throw new VeraZillowResearchError("checkpoint_unavailable");
  }
  if (!response.ok) throw new VeraZillowResearchError("checkpoint_unavailable");
  const decision = await readBoundedJson(response, CHECKPOINT_MAX_BYTES);
  if (
    typeof decision !== "object" ||
    decision === null ||
    typeof decision.allowed !== "boolean" ||
    typeof decision.reason !== "string" ||
    typeof decision.checkedAt !== "string" ||
    Object.keys(decision).length !== 3
  ) {
    throw new VeraZillowResearchError("checkpoint_invalid_response");
  }
  if (!decision.allowed) {
    if (decision.reason === "cancelled") {
      throw new VeraZillowResearchError("cancelled", { manualAction: "cancelled" });
    }
    throw new VeraZillowResearchError(`checkpoint_denied_${decision.reason}`);
  }
}

function recordAction(state, action, dependencies, reference = null, result = "completed") {
  state.safeActionTrail.push({
    action,
    hostname: "www.zillow.com",
    observedReferenceHash: reference === null ? null : sha256(reference),
    result,
    occurredAt: safeNow(dependencies)
  });
}

function parseSharedTabs(payload) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray(payload.tabs) ||
    payload.tabs.length > 100
  ) {
    throw new VeraZillowResearchError("invalid_tabs_response");
  }
  return payload.tabs;
}

function isOpaqueTabReference(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value)
  );
}

function consentTabReference(tab) {
  if (isOpaqueTabReference(tab.tabId)) return tab.tabId;
  if (isOpaqueTabReference(tab.suggestedTargetId)) return tab.suggestedTargetId;
  return tab.targetId;
}

async function prepareBrowserAction(action, state, dependencies, observedReference = null) {
  checkDeadline(state, dependencies);
  await authorizeAction("verify_shared_tab", state, dependencies, {
    observedReferenceHash:
      observedReference === null ? null : sha256(`${action}:${observedReference}`)
  });
  const tabsPayload = await browserGet(
    `/tabs?profile=${BROWSER_PROFILE}`,
    TABS_MAX_BYTES,
    state,
    dependencies
  );
  state.browserActions += 1;
  const tabs = parseSharedTabs(tabsPayload);
  state.lastSharedTabCount = tabs.length;
  if (tabs.length === 0) {
    throw new VeraZillowResearchError("no_shared_tab", { manualAction: "no_shared_tab" });
  }
  if (tabs.length !== 1) {
    throw new VeraZillowResearchError("multiple_shared_tabs", {
      manualAction: "multiple_shared_tabs"
    });
  }
  const tab = tabs[0];
  if (
    typeof tab !== "object" ||
    tab === null ||
    !isOpaqueTabReference(tab.targetId) ||
    typeof tab.url !== "string"
  ) {
    throw new VeraZillowResearchError("shared_tab_changed", {
      manualAction: "shared_tab_changed"
    });
  }
  const stableTabReference = consentTabReference(tab);
  const approvedStartingReference = state.input.startingTabReference;
  const startingReferenceMatches =
    approvedStartingReference.kind === "single_shared_tab" ||
    approvedStartingReference.value === tab.targetId ||
    approvedStartingReference.value === stableTabReference;
  if (
    (state.pinnedConsentTabReference === null && !startingReferenceMatches) ||
    (state.pinnedConsentTabReference !== null &&
      stableTabReference !== state.pinnedConsentTabReference)
  ) {
    throw new VeraZillowResearchError("shared_tab_changed", {
      manualAction: "shared_tab_changed"
    });
  }
  if (state.pinnedConsentTabReference === null) {
    state.pinnedConsentTabReference = stableTabReference;
  }
  const page = validateZillowUrl(tab.url, "either");
  state.activeUrl = page.url;
  const authorizationTabReference =
    approvedStartingReference.kind === "target_id"
      ? approvedStartingReference.value
      : stableTabReference;
  await authorizeAction(action, state, dependencies, {
    activeTabId: authorizationTabReference,
    sharedTabCount: 1,
    hostname: "www.zillow.com",
    observedReferenceHash:
      observedReference === null ? null : sha256(`${action}:${observedReference}`)
  });
  recordAction(state, "verify_shared_tab", dependencies);
  return { targetId: tab.targetId, page };
}

async function takeSnapshot(state, dependencies) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tab = await prepareBrowserAction("snapshot", state, dependencies);
    const query = new URLSearchParams({
      profile: BROWSER_PROFILE,
      format: "ai",
      targetId: tab.targetId,
      maxChars: String(SNAPSHOT_MAX_CHARS),
      compact: "true",
      interactive: "false",
      urls: "false",
      timeoutMs: String(REQUEST_TIMEOUT_MS)
    });
    const payload = await browserGet(
      `/snapshot?${query.toString()}`,
      SNAPSHOT_MAX_BYTES,
      state,
      dependencies
    );
    state.browserActions += 1;
    const document = parseZillowSnapshot(payload);
    if (
      document.targetId === tab.targetId &&
      document.page.kind === tab.page.kind &&
      document.page.url === tab.page.url
    ) {
      state.activeUrl = document.page.url;
      recordAction(state, "snapshot", dependencies);
      return document;
    }
    recordAction(state, "snapshot", dependencies, null, "stopped");
  }
  throw new VeraZillowResearchError("shared_tab_changed", {
    manualAction: "shared_tab_changed"
  });
}

function validateActionResponse(payload, targetId) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.ok !== true ||
    payload.targetId !== targetId ||
    (payload.url !== undefined && typeof payload.url !== "string")
  ) {
    throw new VeraZillowResearchError("invalid_browser_action_response");
  }
  return payload.url === undefined ? null : validateZillowUrl(payload.url, "either");
}

async function activateControl(control, request, state, dependencies) {
  assertSafeControl(control);
  const allowedKinds = new Set(["click", "type"]);
  if (!allowedKinds.has(request.kind)) {
    throw new VeraZillowResearchError("browser_operation_not_allowed");
  }
  if (
    request.kind === "type" &&
    (typeof request.text !== "string" || request.text.length < 1 || request.text.length > 160)
  ) {
    throw new VeraZillowResearchError("browser_operation_not_allowed");
  }
  const tab = await prepareBrowserAction(
    "set_reviewed_filter",
    state,
    dependencies,
    `${control.ref}:${control.name}`
  );
  const body =
    request.kind === "type"
      ? {
          kind: "type",
          targetId: tab.targetId,
          ref: control.ref,
          text: request.text,
          submit: request.submit === true
        }
      : { kind: "click", targetId: tab.targetId, ref: control.ref };
  const payload = await browserPost("/act", body, ACTION_MAX_BYTES, state, dependencies);
  state.browserActions += 1;
  const page = validateActionResponse(payload, tab.targetId);
  if (page) state.activeUrl = page.url;
  recordAction(state, "set_reviewed_filter", dependencies, `${control.ref}:${control.name}`);
}

async function scrollToObservedResult(control, state, dependencies) {
  assertSafeControl(control);
  if (control.role !== "link")
    throw new VeraZillowResearchError("layout_changed", {
      pageState: "layout_changed",
      manualAction: "layout_changed"
    });
  if (state.resultPageExpansions >= MAX_RESULT_EXPANSIONS) {
    throw new VeraZillowResearchError("run_limit_exceeded");
  }
  const tab = await prepareBrowserAction(
    "scroll_bounded",
    state,
    dependencies,
    `${control.ref}:${control.name}`
  );
  const payload = await browserPost(
    "/act",
    { kind: "scrollIntoView", targetId: tab.targetId, ref: control.ref },
    ACTION_MAX_BYTES,
    state,
    dependencies
  );
  state.browserActions += 1;
  validateActionResponse(payload, tab.targetId);
  state.resultPageExpansions += 1;
  recordAction(state, "scroll_bounded", dependencies, `${control.ref}:${control.name}`);
}

async function navigateToObserved(observedUrl, action, state, dependencies) {
  if (!state.observedUrls.has(observedUrl)) {
    throw new VeraZillowResearchError("unobserved_navigation_target");
  }
  const expectedKind = action === "open_observed_listing" ? "detail" : "result";
  validateZillowUrl(observedUrl, expectedKind);
  const tab = await prepareBrowserAction(action, state, dependencies, observedUrl);
  const payload = await browserPost(
    "/navigate",
    { targetId: tab.targetId, url: observedUrl },
    ACTION_MAX_BYTES,
    state,
    dependencies
  );
  state.browserActions += 1;
  const page = validateActionResponse(payload, tab.targetId);
  if (!page || page.kind !== expectedKind) {
    throw new VeraZillowResearchError("unexpected_zillow_redirect", {
      pageState: "blocked",
      manualAction: "blocked"
    });
  }
  state.activeUrl = page.url;
  recordAction(state, action, dependencies, observedUrl);
  return page.url;
}

async function activateObservedListing(card, document, state, dependencies) {
  if (typeof card.resultRef !== "string" || typeof card.observedLinkName !== "string") {
    throw layoutChanged();
  }
  const control = document.refs.find(
    (candidate) =>
      candidate.ref === card.resultRef &&
      candidate.role === "link" &&
      candidate.name === card.observedLinkName
  );
  if (!control) throw layoutChanged();
  assertSafeControl(control);
  const tab = await prepareBrowserAction(
    "open_observed_listing",
    state,
    dependencies,
    `${control.ref}:${control.name}`
  );
  const payload = await browserPost(
    "/act",
    { kind: "click", targetId: tab.targetId, ref: control.ref },
    ACTION_MAX_BYTES,
    state,
    dependencies
  );
  state.browserActions += 1;
  const page = validateActionResponse(payload, tab.targetId);
  if (page && page.kind !== "detail") {
    throw new VeraZillowResearchError("unexpected_zillow_redirect", {
      pageState: "blocked",
      manualAction: "blocked"
    });
  }
  if (page) {
    state.activeUrl = page.url;
    state.observedUrls.add(page.url);
  }
  recordAction(state, "open_observed_listing", dependencies, `${control.ref}:${control.name}`);
  return page?.url ?? null;
}

function layoutChanged() {
  return new VeraZillowResearchError("layout_changed", {
    pageState: "layout_changed",
    manualAction: "layout_changed"
  });
}

function bareRoomValue(value) {
  return new RegExp(`^${String(value).replace(".", "\\.")}\\+$`, "u");
}

function findUniqueReviewedControl(document, input) {
  const roles = new Set(input.roles);
  const candidates = document.refs.filter(
    (entry) => roles.has(entry.role) && input.names.some((pattern) => pattern.test(entry.name))
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function findConsolidatedApplyControl(document) {
  for (const names of [[/^See [\d,]+ rentals? available$/iu], [/^Done$/iu], [/^Save$/iu]]) {
    const matches = document.refs.filter(
      (entry) => entry.role === "button" && names.some((pattern) => pattern.test(entry.name))
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1 && !/^Save$/iu.test(matches[0].name)) throw layoutChanged();
  }
  return null;
}

function semanticTreeMarker(line, index) {
  const match = line.match(
    /^(\s*)-\s+([a-z]+)\s+"([^"]{1,300})"(?:\s+\[ref=([^\]]+)\])?(?:\s+\[[^\]]+\])*:?\s*$/u
  );
  if (!match) return null;
  return {
    index,
    indent: match[1].length,
    role: match[2].toLocaleLowerCase("en-US"),
    name: match[3],
    ref: match[4] ?? null
  };
}

function findUniqueDialogContainedControl(document, input) {
  const lines = document.snapshot.split(/\r?\n/u);
  const markers = lines
    .map((line, index) => semanticTreeMarker(line, index))
    .filter((marker) => marker !== null);
  const dialogs = markers.filter(
    (marker) =>
      marker.role === "dialog" &&
      marker.name.toLocaleLowerCase("en-US") === input.dialogName.toLocaleLowerCase("en-US")
  );
  if (dialogs.length === 0) return null;
  if (dialogs.length !== 1) throw layoutChanged();
  const dialog = dialogs[0];
  let end = lines.length;
  for (let index = dialog.index + 1; index < lines.length; index += 1) {
    if (lines[index].trim().length === 0) continue;
    const indentation = /^\s*/u.exec(lines[index])?.[0].length ?? 0;
    if (indentation <= dialog.indent) {
      end = index;
      break;
    }
  }
  const subtree = markers.filter((marker) => marker.index > dialog.index && marker.index < end);
  const headings = subtree.filter(
    (marker) =>
      marker.role === "heading" &&
      marker.name.toLocaleLowerCase("en-US") === input.dialogName.toLocaleLowerCase("en-US")
  );
  const controls = subtree.filter(
    (marker) =>
      marker.indent === dialog.indent + 2 &&
      marker.role === input.role &&
      marker.name.toLocaleLowerCase("en-US") === input.name.toLocaleLowerCase("en-US") &&
      marker.ref !== null
  );
  if (headings.length !== 1 || controls.length !== 1) throw layoutChanged();
  const control = document.refs.find(
    (entry) =>
      entry.ref === controls[0].ref &&
      entry.role === input.role &&
      entry.name.toLocaleLowerCase("en-US") === input.name.toLocaleLowerCase("en-US")
  );
  if (!control) throw layoutChanged();
  return control;
}

async function closeStaleMoreFilters(document, state, dependencies) {
  const closeButton = findUniqueDialogContainedControl(document, {
    dialogName: "More filters",
    role: "button",
    name: "Close"
  });
  if (!closeButton) return document;
  await activateControl(closeButton, { kind: "click" }, state, dependencies);
  return takeSnapshot(state, dependencies);
}

function findOpenRentalTypePopoverToggle(document) {
  const reviewedRadioNames = ["For sale", "For rent", "Sold"];
  const radios = document.refs.filter(
    (entry) => entry.role === "radio" && reviewedRadioNames.includes(entry.name)
  );
  if (radios.length === 0) return null;
  if (
    radios.length !== reviewedRadioNames.length ||
    reviewedRadioNames.some((name) => radios.filter((entry) => entry.name === name).length !== 1)
  ) {
    throw layoutChanged();
  }
  const toggle = findUniqueReviewedControl(document, {
    roles: ["button"],
    names: [/^For rent$/iu]
  });
  if (!toggle) throw layoutChanged();
  return toggle;
}

async function closeStaleRentalTypePopover(document, state, dependencies) {
  const toggle = findOpenRentalTypePopoverToggle(document);
  if (!toggle) return document;
  await activateControl(toggle, { kind: "click" }, state, dependencies);
  const updated = await takeSnapshot(state, dependencies);
  if (findOpenRentalTypePopoverToggle(updated) !== null) throw layoutChanged();
  return updated;
}

async function applyConsolidatedFilters(filtersButton, initialDocument, state, dependencies) {
  await activateControl(filtersButton, { kind: "click" }, state, dependencies);
  const document = await takeSnapshot(state, dependencies);
  const maximumPrice = findUniqueReviewedControl(document, {
    roles: ["textbox", "combobox", "spinbutton"],
    names: [/^(?:Maximum|Max)(?: rent| price)?$/iu, /^price max$/iu, /^No Max$/iu]
  });
  if (!maximumPrice) throw layoutChanged();
  await activateControl(
    maximumPrice,
    { kind: "type", text: String(state.input.profile.maximumRentUsd) },
    state,
    dependencies
  );

  if (state.input.profile.minimumBedrooms > 0) {
    const bedrooms =
      findUniqueReviewedControl(document, {
        roles: ["button", "radio"],
        names: [
          new RegExp(
            `^${String(state.input.profile.minimumBedrooms).replace(".", "\\.")}\\+? (?:Beds?|Bedrooms?)$`,
            "iu"
          )
        ]
      }) ??
      findReviewedControlInSection(document, {
        roles: ["button", "radio"],
        names: [bareRoomValue(state.input.profile.minimumBedrooms)],
        startNames: [/^Bedrooms$/iu],
        endNames: [/^Bathrooms$/iu]
      });
    if (!bedrooms) throw layoutChanged();
    await activateControl(bedrooms, { kind: "click" }, state, dependencies);
  }

  if (state.input.profile.minimumBathrooms !== undefined) {
    const bathrooms =
      findUniqueReviewedControl(document, {
        roles: ["button", "radio"],
        names: [
          new RegExp(
            `^${String(state.input.profile.minimumBathrooms).replace(".", "\\.")}\\+? (?:Baths?|Bathrooms?)$`,
            "iu"
          )
        ]
      }) ??
      findReviewedControlInSection(document, {
        roles: ["button", "radio"],
        names: [bareRoomValue(state.input.profile.minimumBathrooms)],
        startNames: [/^Bathrooms$/iu],
        endNames:
          state.input.profile.rentalPropertyType === undefined
            ? [/^See [\d,]+ rentals? available$/iu]
            : [/^Property type$/iu, /^Home type$/iu]
      });
    if (!bathrooms) throw layoutChanged();
    await activateControl(bathrooms, { kind: "click" }, state, dependencies);
  }

  if (state.input.profile.rentalPropertyType !== undefined) {
    const labels = {
      apartment: [/^Apartments?$/iu],
      house: [/^Houses?$/iu],
      townhouse: [/^Townhomes?|Townhouses?$/iu],
      condo: [/^Condos?(?:\/Co-ops?)?$/iu]
    };
    const propertyType = findUniqueReviewedControl(document, {
      roles: ["checkbox", "button"],
      names: labels[state.input.profile.rentalPropertyType]
    });
    if (!propertyType) throw layoutChanged();
    await activateControl(propertyType, { kind: "click" }, state, dependencies);
  }

  const apply = findConsolidatedApplyControl(document);
  if (!apply) throw layoutChanged();
  await activateControl(apply, { kind: "click" }, state, dependencies);
  return takeSnapshot(state, dependencies);
}

async function clickFilterApplyIfPresent(document, state, dependencies) {
  const apply = findReviewedControl(document, {
    roles: ["button"],
    names: [/^Done$/iu, /^Save$/iu, /^See [\d,]+ rentals? available$/iu]
  });
  if (apply) await activateControl(apply, { kind: "click" }, state, dependencies);
}

async function applySavedProfile(initialDocument, state, dependencies) {
  let document = await closeStaleMoreFilters(initialDocument, state, dependencies);
  document = await closeStaleRentalTypePopover(document, state, dependencies);
  if (document.page.kind !== "result") throw layoutChanged();

  const location = findReviewedControl(document, {
    roles: ["searchbox", "textbox", "combobox"],
    names: [
      /^Search$/iu,
      /^Search(?: by)? location$/iu,
      /^Where do you want to live\??$/iu,
      /city, neighborhood, zip, address/iu
    ]
  });
  if (location) {
    await activateControl(
      location,
      { kind: "type", text: state.input.profile.location, submit: true },
      state,
      dependencies
    );
    document = await takeSnapshot(state, dependencies);
  } else {
    throw layoutChanged();
  }

  const priceButton = findReviewedControl(document, {
    roles: ["button"],
    names: [
      /^Price$/iu,
      /^Any price$/iu,
      /^Up to \$[1-9][\d,]*(?:\.\d)?K$/u,
      /^\$[\d,]+\s*-\s*(?:\$[\d,]+|No Max)$/iu
    ]
  });
  if (!priceButton) {
    const forRentButtons = document.refs.filter(
      (entry) => entry.role === "button" && /^For rent$/iu.test(entry.name)
    );
    if (forRentButtons.length > 1) throw layoutChanged();
    if (forRentButtons.length === 1) {
      return applyConsolidatedFilters(forRentButtons[0], document, state, dependencies);
    }
    const filtersButton = findUniqueReviewedControl(document, {
      roles: ["button"],
      names: [/^Filters$/iu]
    });
    if (!filtersButton) throw layoutChanged();
    return applyConsolidatedFilters(filtersButton, document, state, dependencies);
  }
  await activateControl(priceButton, { kind: "click" }, state, dependencies);
  document = await takeSnapshot(state, dependencies);
  const maximumPrice = findReviewedControl(document, {
    roles: ["textbox", "combobox", "spinbutton"],
    names: [/^(?:Maximum|Max)(?: rent| price)?$/iu, /^price max$/iu, /^No Max$/iu]
  });
  if (!maximumPrice) throw layoutChanged();
  await activateControl(
    maximumPrice,
    { kind: "type", text: String(state.input.profile.maximumRentUsd) },
    state,
    dependencies
  );
  await clickFilterApplyIfPresent(document, state, dependencies);
  document = await takeSnapshot(state, dependencies);

  if (
    state.input.profile.minimumBedrooms > 0 ||
    state.input.profile.minimumBathrooms !== undefined
  ) {
    const bedsButton = findReviewedControl(document, {
      roles: ["button"],
      names: [/^Beds?(?: & Baths?)?$/iu, /^Beds?\/Baths?$/iu]
    });
    if (!bedsButton) throw layoutChanged();
    await activateControl(bedsButton, { kind: "click" }, state, dependencies);
    document = await takeSnapshot(state, dependencies);
    if (state.input.profile.minimumBedrooms > 0) {
      const bedroomControl = {
        roles: ["button", "radio"],
        names: [
          new RegExp(
            `^${String(state.input.profile.minimumBedrooms).replace(".", "\\.")}\\+? (?:Beds?|Bedrooms?)$`,
            "iu"
          )
        ]
      };
      const bedrooms =
        findReviewedControl(document, bedroomControl) ??
        findReviewedControlInSection(document, {
          roles: ["button", "radio"],
          names: [bareRoomValue(state.input.profile.minimumBedrooms)],
          startNames: [/^Bedrooms$/iu],
          endNames: [/^Bathrooms$/iu]
        });
      if (!bedrooms) throw layoutChanged();
      await activateControl(bedrooms, { kind: "click" }, state, dependencies);
    }
    if (state.input.profile.minimumBathrooms !== undefined) {
      const bathroomControl = {
        roles: ["button", "radio"],
        names: [
          new RegExp(
            `^${String(state.input.profile.minimumBathrooms).replace(".", "\\.")}\\+? (?:Baths?|Bathrooms?)$`,
            "iu"
          )
        ]
      };
      const bathrooms =
        findReviewedControl(document, bathroomControl) ??
        findReviewedControlInSection(document, {
          roles: ["button", "radio"],
          names: [bareRoomValue(state.input.profile.minimumBathrooms)],
          startNames: [/^Bathrooms$/iu],
          endNames: [/^Done$/iu, /^Save$/iu, /^See [\d,]+ rentals? available$/iu]
        });
      if (!bathrooms) throw layoutChanged();
      await activateControl(bathrooms, { kind: "click" }, state, dependencies);
    }
    await clickFilterApplyIfPresent(document, state, dependencies);
    document = await takeSnapshot(state, dependencies);
  }

  if (state.input.profile.rentalPropertyType !== undefined) {
    const homeType = findReviewedControl(document, {
      roles: ["button"],
      names: [/^Home type$/iu, /^Property type$/iu]
    });
    if (!homeType) throw layoutChanged();
    await activateControl(homeType, { kind: "click" }, state, dependencies);
    document = await takeSnapshot(state, dependencies);
    const labels = {
      apartment: [/^Apartments?$/iu],
      house: [/^Houses?$/iu],
      townhouse: [/^Townhomes?|Townhouses?$/iu],
      condo: [/^Condos?(?:\/Co-ops?)?$/iu]
    };
    const propertyType = findReviewedControl(document, {
      roles: ["checkbox", "button"],
      names: labels[state.input.profile.rentalPropertyType]
    });
    if (!propertyType) throw layoutChanged();
    await activateControl(propertyType, { kind: "click" }, state, dependencies);
    await clickFilterApplyIfPresent(document, state, dependencies);
    document = await takeSnapshot(state, dependencies);
  }

  return document;
}

function cardIdentity(card) {
  return (
    card.canonicalObservedUrl ??
    [
      card.observedLinkName ?? "",
      card.address ?? "",
      card.rentUsd ?? "",
      card.bedrooms ?? "",
      card.bathrooms ?? ""
    ].join("\u0000")
  );
}

function mergeCards(existing, observed) {
  const merged = new Map(existing.map((card) => [cardIdentity(card), card]));
  for (const card of observed) {
    const key = cardIdentity(card);
    if (!merged.has(key)) merged.set(key, card);
  }
  return [...merged.values()];
}

function provenanceFor(listing, observedAt, canonicalObservedFrom = "result_card") {
  const entries = [];
  const add = (field, observedFrom, sourceUrl, confidenceBasisPoints = 9_500) => {
    if (entries.some((entry) => entry.field === field)) return;
    entries.push({
      field,
      observedFrom,
      sourceUrl,
      extractionMethod: "openclaw_semantic_snapshot",
      confidenceBasisPoints,
      observedAt
    });
  };
  add("canonical_observed_url", canonicalObservedFrom, listing.canonicalObservedUrl, 10_000);
  if (listing.sourceListingId !== null) {
    add("source_listing_id", canonicalObservedFrom, listing.canonicalObservedUrl, 10_000);
  }
  const detailUrl = listing.finalDetailPageUrl;
  if (detailUrl !== null) add("final_detail_page_url", "detail_page", detailUrl, 10_000);
  const source = detailUrl ?? listing.canonicalObservedUrl;
  const observedFrom = detailUrl === null ? "result_card" : "detail_page";
  if (listing.address !== null) add("address", observedFrom, source);
  if (listing.rentUsd !== null) add("rent", observedFrom, source);
  if (listing.bedrooms !== null) add("bedrooms", observedFrom, source);
  if (listing.bathrooms !== null) add("bathrooms", observedFrom, source);
  if (listing.squareFeet !== null) add("square_footage", observedFrom, source);
  if (listing.availability !== null) add("availability", observedFrom, source);
  if (listing.amenities.length > 0) add("amenities", observedFrom, source);
  return entries;
}

function finalizedListing(card, detail, observedAt) {
  const choose = (key) => detail?.[key] ?? card[key] ?? null;
  const listing = {
    sourceListingId: card.sourceListingId,
    canonicalObservedUrl: card.canonicalObservedUrl,
    finalDetailPageUrl: detail?.finalDetailPageUrl ?? null,
    address: choose("address"),
    rentUsd: choose("rentUsd"),
    bedrooms: choose("bedrooms"),
    bathrooms: choose("bathrooms"),
    squareFeet: choose("squareFeet"),
    availability: choose("availability"),
    amenities:
      detail?.amenities && detail.amenities.length > 0
        ? detail.amenities
        : card.amenities.slice(0, 30),
    observedAt,
    sourceFieldProvenance: [],
    missingFields: [],
    safeExtractionWarnings: [],
    researchNotes: [
      "Observed on one bounded Zillow rental result card.",
      ...(detail ? ["Opened one bounded same-tab Zillow listing detail page."] : [])
    ]
  };
  const missing = [
    ["source_listing_id", "sourceListingId"],
    ["address", "address"],
    ["rent", "rentUsd"],
    ["bedrooms", "bedrooms"],
    ["bathrooms", "bathrooms"],
    ["square_footage", "squareFeet"],
    ["availability", "availability"]
  ];
  listing.missingFields = missing
    .filter(([, key]) => listing[key] === null)
    .map(([field]) => field);
  if (listing.amenities.length === 0) listing.missingFields.push("amenities");
  if (listing.address === null || listing.rentUsd === null) {
    listing.safeExtractionWarnings.push(
      "One or more core listing facts were not visible in the bounded semantic snapshot."
    );
  }
  listing.sourceFieldProvenance = provenanceFor(
    listing,
    observedAt,
    card.canonicalObservedFrom ?? "result_card"
  );
  return listing;
}

function manualPageState(error) {
  if (error.pageState && error.pageState !== "ready") return error.pageState;
  return error.code === "layout_changed" ? "layout_changed" : "ready";
}

function safeFailureOutput(state, error, dependencies) {
  const manualAction =
    error instanceof VeraZillowResearchError && MANUAL_ACTIONS.has(error.manualAction)
      ? error.manualAction
      : null;
  return validateResearchOutput({
    version: "1",
    veraRunId: state.input.veraRunId,
    state:
      manualAction === null
        ? state.listings.length > 0
          ? "partial"
          : "failed"
        : "manual_action_required",
    pageState: error instanceof VeraZillowResearchError ? manualPageState(error) : "ready",
    manualAction,
    listings: state.listings,
    resultCardsObserved: Math.min(state.resultCardsObserved, MAX_RESULTS),
    detailPagesOpened: Math.min(state.detailPagesOpened, MAX_DETAIL_PAGES),
    resultPageExpansions: Math.min(state.resultPageExpansions, MAX_RESULT_EXPANSIONS),
    startedAt: state.startedAt,
    completedAt: safeNow(dependencies),
    safeActionTrail: state.safeActionTrail.slice(0, 100),
    warnings: [
      error instanceof VeraZillowResearchError
        ? `Research stopped safely: ${error.code}.`
        : "Research stopped safely because the bounded tool failed."
    ]
  });
}

export async function researchZillowRentals(
  rawInput,
  dependencies = {
    fetch: globalThis.fetch,
    now: () => new Date(),
    monotonicNow: () => Date.now()
  }
) {
  const input = validateResearchInput(rawInput);
  const state = {
    input,
    startedAt: safeNow(dependencies),
    startedMonotonic: dependencies.monotonicNow(),
    browserActions: 0,
    activeUrl: null,
    pinnedConsentTabReference: null,
    lastSharedTabCount: 1,
    resultCardsObserved: 0,
    detailPagesOpened: 0,
    resultPageExpansions: 0,
    observedUrls: new Set(),
    safeActionTrail: [],
    listings: []
  };

  try {
    let document = await takeSnapshot(state, dependencies);
    document = await applySavedProfile(document, state, dependencies);
    const resultPage = validateZillowUrl(document.page.url, "result").url;
    state.observedUrls.add(resultPage);
    let cards = extractResultCards(document, input.maxResults);
    for (const card of cards) {
      if (card.canonicalObservedUrl !== null) state.observedUrls.add(card.canonicalObservedUrl);
    }

    while (cards.length < input.maxResults && state.resultPageExpansions < MAX_RESULT_EXPANSIONS) {
      const last = cards.at(-1);
      if (!last?.resultRef) break;
      const control = document.refs.find((candidate) => candidate.ref === last.resultRef);
      if (!control) break;
      await scrollToObservedResult(control, state, dependencies);
      document = await takeSnapshot(state, dependencies);
      cards = mergeCards(cards, extractResultCards(document, input.maxResults)).slice(
        0,
        input.maxResults
      );
      for (const card of cards) {
        if (card.canonicalObservedUrl !== null) state.observedUrls.add(card.canonicalObservedUrl);
      }
    }
    if (cards.length === 0) throw layoutChanged();
    state.resultCardsObserved = Math.min(cards.length, input.maxResults);

    for (let index = 0; index < cards.length; index += 1) {
      let card = cards[index];
      let detail = null;
      if (index < input.maxDetailPages) {
        if (card.canonicalObservedUrl === null) {
          const refreshed = extractResultCards(document, input.maxResults).find(
            (candidate) => cardIdentity(candidate) === cardIdentity(card)
          );
          if (!refreshed) throw layoutChanged();
          card = refreshed;
          await activateObservedListing(card, document, state, dependencies);
        } else {
          await navigateToObserved(
            card.canonicalObservedUrl,
            "open_observed_listing",
            state,
            dependencies
          );
        }
        const detailDocument = await takeSnapshot(state, dependencies);
        if (detailDocument.page.kind !== "detail") throw layoutChanged();
        detail = extractDetailEvidence(detailDocument);
        state.observedUrls.add(detail.finalDetailPageUrl);
        if (card.canonicalObservedUrl === null) {
          card = {
            ...card,
            sourceListingId:
              detail.finalDetailPageUrl.match(/\/([1-9][0-9]*)_zpid\/?(?:\?|$)/u)?.[1] ?? null,
            canonicalObservedUrl: detail.finalDetailPageUrl,
            canonicalObservedFrom: "detail_page"
          };
        }
        state.detailPagesOpened += 1;
        await navigateToObserved(resultPage, "return_to_results", state, dependencies);
        document = await takeSnapshot(state, dependencies);
      }
      if (card.canonicalObservedUrl === null) continue;
      state.listings.push(finalizedListing(card, detail, safeNow(dependencies)));
    }

    return validateResearchOutput({
      version: "1",
      veraRunId: input.veraRunId,
      state: state.listings.length < input.maxResults ? "partial" : "completed",
      pageState: "ready",
      manualAction: null,
      listings: state.listings,
      resultCardsObserved: state.resultCardsObserved,
      detailPagesOpened: state.detailPagesOpened,
      resultPageExpansions: state.resultPageExpansions,
      startedAt: state.startedAt,
      completedAt: safeNow(dependencies),
      safeActionTrail: state.safeActionTrail,
      warnings:
        state.listings.length < input.maxResults
          ? ["The bounded Zillow run returned fewer cards than its requested maximum."]
          : []
    });
  } catch (error) {
    return safeFailureOutput(state, error, dependencies);
  }
}

const plugin = {
  id: "vera-zillow-rental-research",
  name: "Vera Zillow Rental Research",
  description: "Runs one founder-authorized, bounded, read-only Zillow rental research workflow.",
  register(api) {
    api.registerTool({
      name: TOOL_NAME,
      label: "Research Zillow rentals",
      description:
        "Use the saved Vera profile to inspect at most ten cards and five details in exactly one explicitly shared Zillow rental tab.",
      parameters: toolParameters,
      async execute(_toolCallId, params) {
        const result = await researchZillowRentals(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result
        };
      }
    });
  }
};

export default plugin;
