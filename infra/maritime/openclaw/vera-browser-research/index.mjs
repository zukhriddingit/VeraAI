import { createHash } from "node:crypto";

import {
  TOOL_NAME,
  VeraBrowserResearchError,
  toolParameters,
  validateObservedUrl,
  validateResearchOutput,
  validateResearchPlan
} from "./contract.mjs";
import {
  assertSafeControl,
  enrichSourceListingFromDetail,
  extractSourceDetailListing,
  extractSourceCardCandidates,
  findControl,
  parseSourceSnapshot,
  sourceStartUrl,
  validateCurrentSharedUrl
} from "./source-snapshot.mjs";

const BROWSER_CONTROL_ORIGIN = "http://127.0.0.1:18792";
const BROWSER_PROFILE = "chrome";
const REQUEST_TIMEOUT_MS = 15_000;
const TABS_MAX_BYTES = 64 * 1024;
const SNAPSHOT_MAX_BYTES = 512 * 1024;
const ACTION_MAX_BYTES = 64 * 1024;
const CHECKPOINT_MAX_BYTES = 16 * 1024;
const SNAPSHOT_MAX_CHARS = 256 * 1024;
const MANUAL_ACTIONS = new Set([
  "login_required",
  "two_factor_required",
  "captcha_required",
  "checkpoint_required",
  "consent_required",
  "blocked",
  "layout_changed",
  "browser_offline",
  "tab_required",
  "multiple_shared_tabs",
  "shared_tab_changed",
  "cancelled"
]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeNow(dependencies) {
  const now = dependencies.now();
  if (!(now instanceof Date) || Number.isNaN(now.getTime()))
    throw new VeraBrowserResearchError("invalid_research_clock");
  return now.toISOString();
}

function elapsed(state, dependencies) {
  const value = dependencies.monotonicNow() - state.startedMonotonic;
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value >= state.plan.maxDurationMilliseconds ||
    state.actionsUsed >= state.plan.maxActions
  ) {
    throw new VeraBrowserResearchError("run_limit_exceeded");
  }
  return Math.floor(value);
}

async function readBoundedJson(response, maximum) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new VeraBrowserResearchError("response_too_large");
  if (!response.body) throw new VeraBrowserResearchError("response_missing");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new VeraBrowserResearchError("response_too_large");
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
    throw new VeraBrowserResearchError("response_invalid_json");
  }
}

function timeout(state, dependencies) {
  const remaining =
    state.plan.maxDurationMilliseconds - (dependencies.monotonicNow() - state.startedMonotonic);
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new VeraBrowserResearchError("run_limit_exceeded");
  return Math.max(250, Math.min(REQUEST_TIMEOUT_MS, Math.floor(remaining)));
}

async function browserGet(path, maximum, state, dependencies) {
  if (
    path !== `/tabs?profile=${BROWSER_PROFILE}` &&
    !path.startsWith("/snapshot?profile=chrome&")
  ) {
    throw new VeraBrowserResearchError("browser_operation_not_allowed");
  }
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token) throw new VeraBrowserResearchError("browser_control_auth_missing");
  let response;
  try {
    response = await dependencies.fetch(new URL(path, BROWSER_CONTROL_ORIGIN), {
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout(state, dependencies))
    });
  } catch {
    throw new VeraBrowserResearchError("browser_offline", { manualAction: "browser_offline" });
  }
  if (!response.ok)
    throw new VeraBrowserResearchError("browser_offline", { manualAction: "browser_offline" });
  return readBoundedJson(response, maximum);
}

async function browserPost(path, body, maximum, state, dependencies) {
  if (path !== "/navigate" && path !== "/act")
    throw new VeraBrowserResearchError("browser_operation_not_allowed");
  if (path === "/act" && !["click", "type", "scrollIntoView"].includes(body.kind)) {
    throw new VeraBrowserResearchError("browser_operation_not_allowed");
  }
  const token = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  if (!token) throw new VeraBrowserResearchError("browser_control_auth_missing");
  let response;
  try {
    response = await dependencies.fetch(new URL(path, BROWSER_CONTROL_ORIGIN), {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout(state, dependencies))
    });
  } catch {
    throw new VeraBrowserResearchError("browser_offline", { manualAction: "browser_offline" });
  }
  if (!response.ok) throw new VeraBrowserResearchError("browser_action_failed");
  return readBoundedJson(response, maximum);
}

function checkpointEndpoint() {
  const raw = process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_URL?.trim();
  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new VeraBrowserResearchError("checkpoint_not_configured");
  }
  const loopback =
    endpoint.protocol === "http:" && ["127.0.0.1", "localhost"].includes(endpoint.hostname);
  if (
    (!loopback && endpoint.protocol !== "https:") ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  ) {
    throw new VeraBrowserResearchError("checkpoint_not_configured");
  }
  return endpoint;
}

async function authorize(action, state, dependencies) {
  const token = process.env.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN?.trim();
  if (!token || token.length < 32) throw new VeraBrowserResearchError("checkpoint_not_configured");
  const body = {
    version: "1",
    plan: state.plan,
    action,
    activeTabReference: state.plan.startingTabReference,
    sharedTabCount: state.sharedTabCount,
    hostname: state.plan.allowedHostnames[0],
    elapsedMilliseconds: elapsed(state, dependencies),
    resultCardsObserved: state.resultCardsObserved,
    detailPagesOpened: state.detailPagesOpened,
    actionsUsed: state.actionsUsed,
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
      signal: AbortSignal.timeout(timeout(state, dependencies))
    });
  } catch {
    throw new VeraBrowserResearchError("checkpoint_unavailable");
  }
  if (!response.ok) throw new VeraBrowserResearchError("checkpoint_unavailable");
  const decision = await readBoundedJson(response, CHECKPOINT_MAX_BYTES);
  if (
    typeof decision !== "object" ||
    decision === null ||
    Object.keys(decision).length !== 3 ||
    typeof decision.allowed !== "boolean" ||
    typeof decision.reason !== "string" ||
    typeof decision.checkedAt !== "string"
  ) {
    throw new VeraBrowserResearchError("checkpoint_invalid_response");
  }
  if (!decision.allowed) {
    if (decision.reason === "cancelled")
      throw new VeraBrowserResearchError("cancelled", { manualAction: "cancelled" });
    throw new VeraBrowserResearchError(`checkpoint_denied_${decision.reason}`);
  }
}

function record(state, action, dependencies, reference = null, result = "completed") {
  state.safeActionTrail.push({
    action,
    hostname: state.plan.allowedHostnames[0],
    observedReferenceHash: reference === null ? null : sha256(reference),
    result,
    occurredAt: safeNow(dependencies)
  });
}

function parseTabs(payload) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray(payload.tabs) ||
    payload.tabs.length > 100
  ) {
    throw new VeraBrowserResearchError("invalid_tabs_response");
  }
  return payload.tabs;
}

function opaque(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value)
  );
}

function stableReference(tab) {
  if (opaque(tab.tabId)) return tab.tabId;
  if (opaque(tab.suggestedTargetId)) return tab.suggestedTargetId;
  return tab.targetId;
}

async function prepare(action, state, dependencies, reference = null) {
  await authorize("inspect_shared_tabs", state, dependencies);
  const payload = await browserGet(
    `/tabs?profile=${BROWSER_PROFILE}`,
    TABS_MAX_BYTES,
    state,
    dependencies
  );
  state.actionsUsed += 1;
  const tabs = parseTabs(payload);
  state.sharedTabCount = tabs.length;
  if (tabs.length === 0)
    throw new VeraBrowserResearchError("tab_required", { manualAction: "tab_required" });
  if (tabs.length !== 1)
    throw new VeraBrowserResearchError("multiple_shared_tabs", {
      manualAction: "multiple_shared_tabs"
    });
  const tab = tabs[0];
  if (
    typeof tab !== "object" ||
    tab === null ||
    !opaque(tab.targetId) ||
    typeof tab.url !== "string"
  ) {
    throw new VeraBrowserResearchError("shared_tab_changed", {
      manualAction: "shared_tab_changed"
    });
  }
  validateCurrentSharedUrl(tab.url, state.plan);
  const stable = stableReference(tab);
  const approved = state.plan.startingTabReference;
  const matches =
    approved.kind === "single_shared_tab" ||
    approved.value === tab.targetId ||
    approved.value === stable;
  if (
    (state.pinnedTab === null && !matches) ||
    (state.pinnedTab !== null && state.pinnedTab !== stable)
  ) {
    throw new VeraBrowserResearchError("shared_tab_changed", {
      manualAction: "shared_tab_changed"
    });
  }
  state.pinnedTab ??= stable;
  await authorize(action, state, dependencies);
  record(state, "inspect_shared_tabs", dependencies);
  return { targetId: tab.targetId, url: tab.url, reference };
}

function actionResponse(payload, targetId) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    payload.ok !== true ||
    payload.targetId !== targetId ||
    (payload.url !== undefined && typeof payload.url !== "string")
  ) {
    throw new VeraBrowserResearchError("invalid_browser_action_response");
  }
  return payload.url ?? null;
}

async function navigate(url, action, state, dependencies) {
  validateObservedUrl(
    url,
    state.plan.source,
    action === "open_observed_listing" ? "detail" : "result",
    state.plan.sourceConfiguration
  );
  if (
    (action === "open_observed_listing" || action === "return_to_results") &&
    !state.observedUrls.has(url)
  ) {
    throw new VeraBrowserResearchError("unobserved_navigation_target");
  }
  const tab = await prepare(action, state, dependencies, url);
  const payload = await browserPost(
    "/navigate",
    { targetId: tab.targetId, url },
    ACTION_MAX_BYTES,
    state,
    dependencies
  );
  state.actionsUsed += 1;
  const finalUrl = actionResponse(payload, tab.targetId);
  if (!finalUrl)
    throw new VeraBrowserResearchError("unexpected_source_redirect", {
      pageState: "blocked",
      manualAction: "blocked"
    });
  validateObservedUrl(
    finalUrl,
    state.plan.source,
    action === "open_observed_listing" ? "detail" : "result",
    state.plan.sourceConfiguration
  );
  record(state, action, dependencies, url);
}

async function snapshot(state, dependencies) {
  const tab = await prepare("snapshot", state, dependencies);
  const query = new URLSearchParams({
    profile: BROWSER_PROFILE,
    format: "ai",
    targetId: tab.targetId,
    maxChars: String(SNAPSHOT_MAX_CHARS),
    compact: "true",
    interactive: "false",
    urls: "true",
    timeoutMs: String(REQUEST_TIMEOUT_MS)
  });
  const payload = await browserGet(
    `/snapshot?${query.toString()}`,
    SNAPSHOT_MAX_BYTES,
    state,
    dependencies
  );
  state.actionsUsed += 1;
  const document = parseSourceSnapshot(payload, state.plan);
  if (document.targetId !== tab.targetId)
    throw new VeraBrowserResearchError("shared_tab_changed", {
      manualAction: "shared_tab_changed"
    });
  record(state, "snapshot", dependencies);
  return document;
}

async function activate(control, kind, state, dependencies, text = null) {
  assertSafeControl(control);
  if (kind === "type" && (typeof text !== "string" || text.length < 1 || text.length > 160)) {
    throw new VeraBrowserResearchError("browser_operation_not_allowed");
  }
  const action = kind === "type" ? "fill_approved_search_field" : "select_reviewed_filter";
  const tab = await prepare(action, state, dependencies, `${control.ref}:${control.name}`);
  const body =
    kind === "type"
      ? { kind, targetId: tab.targetId, ref: control.ref, text, submit: false }
      : { kind, targetId: tab.targetId, ref: control.ref };
  const payload = await browserPost("/act", body, ACTION_MAX_BYTES, state, dependencies);
  state.actionsUsed += 1;
  actionResponse(payload, tab.targetId);
  record(state, action, dependencies, `${control.ref}:${control.name}`);
}

async function scrollToObservedCandidate(candidate, document, state, dependencies) {
  const control = document.refs.find(
    (entry) =>
      entry.ref === candidate.resultRef &&
      entry.role === "link" &&
      entry.name === candidate.observedLinkName
  );
  assertSafeControl(control);
  const tab = await prepare(
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
  state.actionsUsed += 1;
  actionResponse(payload, tab.targetId);
  state.resultPageExpansions += 1;
  record(state, "scroll_bounded", dependencies, `${control.ref}:${control.name}`);
}

function candidateIdentity(candidate) {
  return candidate.listing.canonicalObservedUrl;
}

function mergeCandidates(existing, observed, maximum) {
  const merged = new Map(existing.map((candidate) => [candidateIdentity(candidate), candidate]));
  for (const candidate of observed) {
    if (!merged.has(candidateIdentity(candidate))) {
      merged.set(candidateIdentity(candidate), candidate);
    }
  }
  return [...merged.values()].slice(0, maximum);
}

function hasActionBudget(state, needed) {
  return state.actionsUsed + needed <= state.plan.maxActions;
}

async function applyApartmentsFilters(document, state, dependencies) {
  const profile = state.plan.profile;
  const price = findControl(document, ["button"], [/^Price\b/iu]);
  if (!price) throw layoutChanged();
  await activate(price, "click", state, dependencies);
  document = await snapshot(state, dependencies);
  const maximum = findControl(document, ["textbox"], [/^maximum Rent Input$/iu]);
  if (!maximum) throw layoutChanged();
  await activate(maximum, "type", state, dependencies, String(profile.maximumRentUsd));
  document = await snapshot(state, dependencies);
  const priceDone = findControl(document, ["button"], [/^Done$/iu]);
  if (!priceDone) throw layoutChanged();
  await activate(priceDone, "click", state, dependencies);
  document = await snapshot(state, dependencies);

  const bedsBaths = findControl(document, ["button"], [/^Beds\/Baths\b/iu]);
  if (!bedsBaths) throw layoutChanged();
  await activate(bedsBaths, "click", state, dependencies);
  document = await snapshot(state, dependencies);
  const beds = findControl(
    document,
    ["button"],
    [new RegExp(`^${Math.max(1, Math.ceil(profile.minimumBedrooms))}\\+$`, "u")],
    0
  );
  if (!beds) throw layoutChanged();
  await activate(beds, "click", state, dependencies);
  document = await snapshot(state, dependencies);
  if (profile.minimumBathrooms !== undefined) {
    const sameLabelOccurrence =
      Math.ceil(profile.minimumBathrooms) === Math.max(1, Math.ceil(profile.minimumBedrooms))
        ? 1
        : 0;
    const baths = findControl(
      document,
      ["button"],
      [new RegExp(`^${Math.max(1, Math.ceil(profile.minimumBathrooms))}\\+$`, "u")],
      sameLabelOccurrence
    );
    if (!baths) throw layoutChanged();
    await activate(baths, "click", state, dependencies);
    document = await snapshot(state, dependencies);
  }
  const done = findControl(document, ["button"], [/^Done$/iu]);
  if (!done) throw layoutChanged();
  await activate(done, "click", state, dependencies);
  document = await snapshot(state, dependencies);
  if (profile.rentalPropertyType !== undefined) {
    const allFilters = findControl(document, ["button"], [/All Filters$/iu]);
    if (!allFilters) throw layoutChanged();
    await activate(allFilters, "click", state, dependencies);
    document = await snapshot(state, dependencies);
    const label = {
      apartment: /^.*Apartments$/iu,
      house: /^.*Houses$/iu,
      condo: /^.*Condos$/iu,
      townhouse: /^.*Townhomes$/iu
    }[profile.rentalPropertyType];
    const propertyType = findControl(document, ["button"], [label]);
    if (!propertyType) throw layoutChanged();
    await activate(propertyType, "click", state, dependencies);
    document = await snapshot(state, dependencies);
    const results = findControl(document, ["button"], [/^See [\d,]+ Results$/iu]);
    if (!results) throw layoutChanged();
    await activate(results, "click", state, dependencies);
    document = await snapshot(state, dependencies);
  }
  return document;
}

async function applyFacebookFilters(document, state, dependencies) {
  const profile = state.plan.profile;
  const maximum = findControl(document, ["textbox"], [/^Maximum range$/iu], 0);
  if (!maximum) throw layoutChanged();
  await activate(maximum, "type", state, dependencies, String(profile.maximumRentUsd));
  document = await snapshot(state, dependencies);
  const bedroomsButton = findControl(document, ["button"], [/^Bedrooms$/iu]);
  if (!bedroomsButton) throw layoutChanged();
  await activate(bedroomsButton, "click", state, dependencies);
  document = await snapshot(state, dependencies);
  const bedrooms = findControl(
    document,
    ["radio"],
    [new RegExp(`^${Math.max(1, Math.ceil(profile.minimumBedrooms))}\\+$`, "u")]
  );
  if (!bedrooms) throw layoutChanged();
  await activate(bedrooms, "click", state, dependencies);
  document = await snapshot(state, dependencies);
  if (profile.minimumBathrooms !== undefined) {
    const bathroomsButton = findControl(document, ["button"], [/^Bathrooms$/iu]);
    if (!bathroomsButton) throw layoutChanged();
    await activate(bathroomsButton, "click", state, dependencies);
    document = await snapshot(state, dependencies);
    const bathrooms = findControl(
      document,
      ["radio"],
      [new RegExp(`^${Math.max(1, Math.ceil(profile.minimumBathrooms))}\\+$`, "u")]
    );
    if (!bathrooms) throw layoutChanged();
    await activate(bathrooms, "click", state, dependencies);
    document = await snapshot(state, dependencies);
  }
  if (profile.rentalPropertyType !== undefined) {
    const typeButton = findControl(document, ["button"], [/^Type of property for rent$/iu]);
    if (!typeButton) throw layoutChanged();
    await activate(typeButton, "click", state, dependencies);
    document = await snapshot(state, dependencies);
    const label = {
      apartment: /^Flat\/apartment$/iu,
      condo: /^Flat\/apartment$/iu,
      house: /^House$/iu,
      townhouse: /^Townhouse$/iu
    }[profile.rentalPropertyType];
    const propertyType = findControl(document, ["checkbox"], [label]);
    if (!propertyType) throw layoutChanged();
    await activate(propertyType, "click", state, dependencies);
    document = await snapshot(state, dependencies);
  }
  return document;
}

function layoutChanged() {
  return new VeraBrowserResearchError("layout_changed", {
    pageState: "layout_changed",
    manualAction: "layout_changed"
  });
}

function manualPageState(error) {
  if (error.pageState && error.pageState !== "ready") return error.pageState;
  return error.code === "layout_changed" ? "layout_changed" : "ready";
}

function failure(state, error, dependencies) {
  const manualAction =
    error instanceof VeraBrowserResearchError && MANUAL_ACTIONS.has(error.manualAction)
      ? error.manualAction
      : null;
  return validateResearchOutput(
    {
      version: "1",
      veraRunId: state.plan.veraRunId,
      source: state.plan.source,
      state:
        manualAction === null
          ? state.listings.length
            ? "partial"
            : "failed"
          : "manual_action_required",
      pageState: error instanceof VeraBrowserResearchError ? manualPageState(error) : "ready",
      manualAction,
      listings: state.listings,
      resultCardsObserved: Math.min(state.resultCardsObserved, state.plan.maxResults),
      detailPagesOpened: Math.min(state.detailPagesOpened, state.plan.maxDetailPages),
      actionsUsed: Math.min(state.actionsUsed, state.plan.maxActions),
      startedAt: state.startedAt,
      completedAt: safeNow(dependencies),
      safeActionTrail: state.safeActionTrail.slice(0, state.plan.maxActions),
      warnings: [
        error instanceof VeraBrowserResearchError
          ? `Research stopped safely: ${error.code}.`
          : "Research stopped safely because the bounded tool failed."
      ]
    },
    state.plan
  );
}

export async function researchRentals(
  rawPlan,
  dependencies = {
    fetch: globalThis.fetch,
    now: () => new Date(),
    monotonicNow: () => Date.now(),
    wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  }
) {
  const plan = validateResearchPlan(rawPlan);
  const state = {
    plan,
    startedAt: safeNow(dependencies),
    startedMonotonic: dependencies.monotonicNow(),
    actionsUsed: 0,
    sharedTabCount: 1,
    pinnedTab: null,
    resultCardsObserved: 0,
    detailPagesOpened: 0,
    resultPageExpansions: 0,
    safeActionTrail: [],
    listings: [],
    observedUrls: new Set()
  };
  try {
    if (plan.mode === "current_page") {
      const detailDocument = await snapshot(state, dependencies);
      await authorize("extract_observed_facts", state, dependencies);
      state.listings = [
        extractSourceDetailListing(
          plan.source,
          detailDocument.page.url,
          detailDocument,
          safeNow(dependencies),
          plan.sourceConfiguration ?? null
        )
      ];
      state.detailPagesOpened = 1;
      record(state, "extract_observed_facts", dependencies, detailDocument.page.url);
      return validateResearchOutput(
        {
          version: "1",
          veraRunId: plan.veraRunId,
          source: plan.source,
          state: "completed",
          pageState: "ready",
          manualAction: null,
          listings: state.listings,
          resultCardsObserved: 0,
          detailPagesOpened: 1,
          actionsUsed: state.actionsUsed,
          startedAt: state.startedAt,
          completedAt: safeNow(dependencies),
          safeActionTrail: state.safeActionTrail,
          warnings: []
        },
        plan
      );
    }
    if (plan.mode === "enrichment") {
      const targetUrl = plan.targetListingUrl;
      state.observedUrls.add(targetUrl);
      await navigate(targetUrl, "open_observed_listing", state, dependencies);
      await dependencies.wait(650);
      const detailDocument = await snapshot(state, dependencies);
      await authorize("extract_observed_facts", state, dependencies);
      state.listings = [
        extractSourceDetailListing(
          plan.source,
          targetUrl,
          detailDocument,
          safeNow(dependencies),
          plan.sourceConfiguration ?? null
        )
      ];
      state.detailPagesOpened = 1;
      record(state, "extract_observed_facts", dependencies, targetUrl);
      return validateResearchOutput(
        {
          version: "1",
          veraRunId: plan.veraRunId,
          source: plan.source,
          state: "completed",
          pageState: "ready",
          manualAction: null,
          listings: state.listings,
          resultCardsObserved: 0,
          detailPagesOpened: 1,
          actionsUsed: state.actionsUsed,
          startedAt: state.startedAt,
          completedAt: safeNow(dependencies),
          safeActionTrail: state.safeActionTrail,
          warnings: []
        },
        plan
      );
    }
    if (plan.source === "zillow")
      throw new VeraBrowserResearchError("source_uses_accepted_zillow_tool");
    const resultPage = sourceStartUrl(plan);
    state.observedUrls.add(resultPage);
    await navigate(resultPage, "navigate_same_source", state, dependencies);
    await dependencies.wait(1_500);
    let document = await snapshot(state, dependencies);
    if (plan.source === "apartments_com") {
      document = await applyApartmentsFilters(document, state, dependencies);
    } else if (plan.source === "facebook_marketplace") {
      document = await applyFacebookFilters(document, state, dependencies);
    }
    await dependencies.wait(1_500);
    document = await snapshot(state, dependencies);
    const observedResultPage = document.page.url;
    state.observedUrls.add(observedResultPage);
    const observedAt = safeNow(dependencies);
    let candidates = extractSourceCardCandidates(document, plan, observedAt);
    if (plan.source === "custom_website" && candidates.length < 2) throw layoutChanged();
    for (const candidate of candidates) {
      state.observedUrls.add(candidate.listing.canonicalObservedUrl);
    }
    while (
      candidates.length < plan.maxResults &&
      state.resultPageExpansions < 2 &&
      hasActionBudget(state, 4)
    ) {
      const last = candidates.at(-1);
      if (!last?.resultRef) break;
      const previousCount = candidates.length;
      await scrollToObservedCandidate(last, document, state, dependencies);
      await dependencies.wait(650);
      document = await snapshot(state, dependencies);
      candidates = mergeCandidates(
        candidates,
        extractSourceCardCandidates(document, plan, safeNow(dependencies)),
        plan.maxResults
      );
      for (const candidate of candidates) {
        state.observedUrls.add(candidate.listing.canonicalObservedUrl);
      }
      if (candidates.length === previousCount) break;
    }
    await authorize("extract_observed_facts", state, dependencies);
    state.listings = candidates.map((candidate) => candidate.listing);
    state.resultCardsObserved = state.listings.length;
    record(state, "extract_observed_facts", dependencies);
    for (
      let index = 0;
      index < candidates.length && state.detailPagesOpened < plan.maxDetailPages;
      index += 1
    ) {
      if (!hasActionBudget(state, 6)) break;
      const candidate = candidates[index];
      await navigate(
        candidate.listing.canonicalObservedUrl,
        "open_observed_listing",
        state,
        dependencies
      );
      await dependencies.wait(650);
      const detailDocument = await snapshot(state, dependencies);
      state.listings[index] = enrichSourceListingFromDetail(
        state.listings[index],
        detailDocument,
        safeNow(dependencies)
      );
      state.detailPagesOpened += 1;
      await navigate(observedResultPage, "return_to_results", state, dependencies);
      await dependencies.wait(400);
    }
    const detailBudgetLimited =
      state.detailPagesOpened < Math.min(plan.maxDetailPages, candidates.length);
    return validateResearchOutput(
      {
        version: "1",
        veraRunId: plan.veraRunId,
        source: plan.source,
        state:
          state.listings.length === 0
            ? "no_results"
            : state.listings.length < plan.maxResults || detailBudgetLimited
              ? "partial"
              : "completed",
        pageState: state.listings.length === 0 ? "no_results" : "ready",
        manualAction: null,
        listings: state.listings,
        resultCardsObserved: state.resultCardsObserved,
        detailPagesOpened: state.detailPagesOpened,
        actionsUsed: state.actionsUsed,
        startedAt: state.startedAt,
        completedAt: safeNow(dependencies),
        safeActionTrail: state.safeActionTrail,
        warnings: [
          ...(state.listings.length < plan.maxResults
            ? ["The bounded run returned fewer cards than its requested maximum."]
            : []),
          ...(detailBudgetLimited
            ? ["The action limit stopped detail inspection before the requested maximum."]
            : [])
        ]
      },
      plan
    );
  } catch (error) {
    return failure(state, error, dependencies);
  }
}

const plugin = {
  id: "vera-browser-research",
  name: "Vera Browser Research",
  description: "Runs one server-signed founder-authorized bounded rental-source research plan.",
  register(api) {
    api.registerTool({
      name: TOOL_NAME,
      label: "Research approved rental source",
      description:
        "Run one signed, bounded, read-only rental-source plan against exactly one explicitly shared tab.",
      parameters: toolParameters,
      async execute(_toolCallId, params) {
        const result = await researchRentals(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      }
    });
  }
};

export default plugin;
