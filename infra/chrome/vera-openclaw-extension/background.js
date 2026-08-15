/* global chrome, WebSocket */

// Reviewed OpenClaw 2.0.0 relay transport with Vera's prepared consent-tab lease.
// Tab-group membership remains the user-visible consent boundary. A tab is not
// reported to the relay until this extension owns an active debugger attachment.

import {
  OPENCLAW_TAB_GROUP_TITLE,
  buildRelayWsProtocols,
  nearestGroupColor,
  parsePairingString,
  reconnectDelayMs,
  toRelayTabInfo
} from "./modules/relay-core.js";
import {
  ENROLLMENT_PROTOCOL_VERSION,
  EXTENSION_VERSION,
  EnrollmentError,
  createInstallationId,
  digestInstallationId,
  enrollWithGateway,
  parseEnrollmentRequest
} from "./modules/enrollment.js";
import {
  PREPARED_SEARCH_START_URL,
  PreparedTabError,
  TAB_READINESS,
  classifyDebuggerAttachError,
  deriveTabReadiness,
  prepareDedicatedSearchTab,
  shareExistingTab,
  validateShareableTabUrl
} from "./modules/prepared-tab.js";

const BADGE = {
  off: { text: "", color: "#000000" },
  connecting: { text: "…", color: "#F59E0B" },
  on: { text: "ON", color: "#0F9D58" },
  error: { text: "!", color: "#B91C1C" }
};

let relayWs = null;
let relayState = "off";
let reconnectAttempt = 0;
let reconnectTimer = null;
let tabsSyncTimer = null;
let tabReadiness = TAB_READINESS.NOT_SHARED;
let installationIdentityPromise = null;
const attachedTabs = new Set();
const attachingTabs = new Map();
const NAVIGATION_REATTACH_DELAYS_MS = Object.freeze([0, 150, 400]);
const PREPARED_NAVIGATION_TIMEOUT_MS = 15_000;
const PREPARED_NAVIGATION_POLL_MS = 100;

function setBadge(kind) {
  relayState = kind;
  const configuration = BADGE[kind] ?? BADGE.off;
  void chrome.action.setBadgeText({ text: configuration.text });
  void chrome.action.setBadgeBackgroundColor({ color: configuration.color });
}

async function getConfig() {
  const stored = await chrome.storage.local.get(["relayUrl", "token", "groupColor"]);
  return {
    relayUrl: typeof stored.relayUrl === "string" ? stored.relayUrl : "",
    token: typeof stored.token === "string" ? stored.token : "",
    groupColor: typeof stored.groupColor === "string" ? stored.groupColor : "orange"
  };
}

async function loadInstallationIdentity() {
  const stored = await chrome.storage.local.get(["installationId"]);
  let installationId =
    typeof stored.installationId === "string" && /^[a-f0-9]{64}$/u.test(stored.installationId)
      ? stored.installationId
      : "";
  if (!installationId) {
    installationId = createInstallationId();
    await chrome.storage.local.set({ installationId });
  }
  return {
    installationId,
    installationDigest: await digestInstallationId(installationId)
  };
}

async function getInstallationIdentity() {
  if (!installationIdentityPromise) {
    installationIdentityPromise = loadInstallationIdentity().catch((error) => {
      installationIdentityPromise = null;
      throw error;
    });
  }
  return installationIdentityPromise;
}

function enrollmentFailureState(error) {
  if (!(error instanceof EnrollmentError)) return "unavailable";
  if (
    error.code === "expired" ||
    error.code === "denied" ||
    error.code === "unavailable" ||
    error.code === "version_incompatible"
  ) {
    return error.code;
  }
  return "unavailable";
}

async function findOpenClawGroups() {
  try {
    return await chrome.tabGroups.query({ title: OPENCLAW_TAB_GROUP_TITLE });
  } catch {
    return [];
  }
}

async function listSharedTabs() {
  const groups = await findOpenClawGroups();
  const tabs = [];
  for (const group of groups) {
    tabs.push(...(await chrome.tabs.query({ groupId: group.id })));
  }
  return tabs.filter((tab) => typeof tab.id === "number");
}

async function addTabToOpenClawGroup(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const groups = await findOpenClawGroups();
  const sameWindowGroup = groups.find((group) => group.windowId === tab.windowId);
  if (sameWindowGroup) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: sameWindowGroup.id });
    return;
  }
  const { groupColor } = await getConfig();
  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, {
    title: OPENCLAW_TAB_GROUP_TITLE,
    color: groupColor
  });
}

async function removeTabFromOpenClawGroup(tabId) {
  try {
    await chrome.tabs.ungroup([tabId]);
  } catch {
    // The tab may already be closed or ungrouped.
  }
}

async function isTabShared(tabId) {
  return (await listSharedTabs()).some((tab) => tab.id === tabId);
}

async function targetForTab(tabId) {
  const targets = await chrome.debugger.getTargets();
  return targets.find((candidate) => candidate.tabId === tabId && candidate.attached) ?? null;
}

async function hasOwnedDebuggerAttachment(tabId) {
  const target = await targetForTab(tabId);
  if (!target) {
    attachedTabs.delete(tabId);
    return false;
  }
  if (attachedTabs.has(tabId)) return true;
  try {
    // This does not evaluate page code or return page data. It distinguishes an
    // attachment owned by this extension after reconciliation from another debugger.
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});
    attachedTabs.add(tabId);
    return true;
  } catch {
    return false;
  }
}

async function attachDebugger(tabId) {
  if (!(await isTabShared(tabId))) {
    throw new PreparedTabError(TAB_READINESS.NOT_SHARED);
  }
  const inFlight = attachingTabs.get(tabId);
  if (inFlight) return inFlight;
  const operation = (async () => {
    if (!(await hasOwnedDebuggerAttachment(tabId))) {
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch (error) {
        throw new PreparedTabError(classifyDebuggerAttachError(error));
      }
      attachedTabs.add(tabId);
    }
    const target = await targetForTab(tabId);
    if (!target) throw new PreparedTabError(TAB_READINESS.ATTACHMENT_FAILED);
    tabReadiness = TAB_READINESS.READY;
    return { targetId: target.id };
  })();
  attachingTabs.set(tabId, operation);
  try {
    return await operation;
  } finally {
    attachingTabs.delete(tabId);
  }
}

async function detachDebugger(tabId) {
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached or gone.
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isReviewedPreparedDestination(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.zillow.com" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

async function waitForPreparedNavigation(tabId) {
  const deadline = Date.now() + PREPARED_NAVIGATION_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.status === "complete" && isReviewedPreparedDestination(tab.url ?? "")) return;
    await delay(PREPARED_NAVIGATION_POLL_MS);
  }
  throw new PreparedTabError(TAB_READINESS.ATTACHMENT_FAILED);
}

async function readySharedTabs() {
  const shared = await listSharedTabs();
  const ready = [];
  if (shared.length === 1 && (await hasOwnedDebuggerAttachment(shared[0].id))) {
    ready.push(shared[0]);
  }
  return { shared, ready };
}

function send(message) {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) {
    relayWs.send(JSON.stringify(message));
  }
}

async function syncTabsToRelay() {
  const { shared, ready } = await readySharedTabs();
  if (shared.length > 1) {
    for (const tabId of [...attachedTabs]) await detachDebugger(tabId);
    tabReadiness = TAB_READINESS.MULTIPLE_SHARED_TABS;
    send({ type: "tabs", tabs: [] });
    return;
  }
  const sharedIds = new Set(shared.map((tab) => tab.id));
  for (const tabId of attachedTabs) {
    if (!sharedIds.has(tabId)) void detachDebugger(tabId);
  }
  if (shared.length === 0 && tabReadiness === TAB_READINESS.READY) {
    tabReadiness = TAB_READINESS.NOT_SHARED;
  }
  send({ type: "tabs", tabs: ready.map(toRelayTabInfo) });
}

function scheduleTabsSync() {
  if (tabsSyncTimer) return;
  tabsSyncTimer = setTimeout(() => {
    tabsSyncTimer = null;
    void syncTabsToRelay();
  }, 150);
}

async function revokeSharedTabs() {
  const shared = await listSharedTabs();
  for (const tab of shared) {
    await detachDebugger(tab.id);
    await removeTabFromOpenClawGroup(tab.id);
  }
  tabReadiness = TAB_READINESS.NOT_SHARED;
  await syncTabsToRelay();
}

function preparedDependencies() {
  return {
    listSharedTabs,
    createBlankTab: async () => chrome.tabs.create({ url: "about:blank", active: true }),
    groupTab: addTabToOpenClawGroup,
    attachTab: attachDebugger,
    navigateTab: async (tabId, url) => chrome.tabs.update(tabId, { url }),
    waitForTabReady: async (tabId) => waitForPreparedNavigation(tabId),
    detachTab: detachDebugger,
    ungroupTab: removeTabFromOpenClawGroup,
    closeTab: async (tabId) => chrome.tabs.remove(tabId),
    syncTabs: syncTabsToRelay
  };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (typeof source.tabId !== "number" || !attachedTabs.has(source.tabId)) return;
  send({
    type: "cdpEvent",
    tabId: source.tabId,
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    method,
    params
  });
});

async function recoverNavigationDebuggerLease(tabId) {
  for (const retryDelay of NAVIGATION_REATTACH_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay);
    const shared = await listSharedTabs();
    if (shared.length !== 1 || shared[0]?.id !== tabId) return false;
    try {
      await attachDebugger(tabId);
      await syncTabsToRelay();
      return true;
    } catch (error) {
      const code =
        error instanceof PreparedTabError ? error.code : classifyDebuggerAttachError(error);
      if (
        code === TAB_READINESS.DEBUGGER_CONFLICT ||
        code === TAB_READINESS.BROWSER_EXTENSION_CONFLICT
      ) {
        return false;
      }
    }
  }
  return false;
}

export async function handleDebuggerDetach(source, reason) {
  if (typeof source.tabId !== "number") return;
  attachedTabs.delete(source.tabId);
  send({ type: "detached", tabId: source.tabId, reason });
  if (!(await isTabShared(source.tabId))) return;
  if (reason === "target_closed" && (await recoverNavigationDebuggerLease(source.tabId))) return;
  await removeTabFromOpenClawGroup(source.tabId);
  tabReadiness =
    reason === "canceled_by_user" ? TAB_READINESS.NOT_SHARED : TAB_READINESS.DEBUGGER_CONFLICT;
  scheduleTabsSync();
}

chrome.debugger.onDetach.addListener((source, reason) => {
  void handleDebuggerDetach(source, reason);
});

export async function handleRelayCommand(message) {
  const { seq } = message;
  try {
    switch (message.type) {
      case "ping":
        send({ type: "pong" });
        return;
      case "attach": {
        const result = await attachDebugger(message.tabId);
        send({ type: "result", seq, result });
        return;
      }
      case "detach":
        // Relay detach ends the current bounded research session, not the user's
        // explicit tab-sharing consent. Keep this extension's debugger lease so
        // the prepared tab stays ready for the next user-triggered source run.
        // Explicit unshare, unpair, tab close, or Chrome debugger cancellation
        // still calls detachDebugger and revokes the lease immediately.
        scheduleTabsSync();
        send({ type: "result", seq, result: {} });
        return;
      case "cdp": {
        if (!attachedTabs.has(message.tabId)) {
          throw new PreparedTabError(TAB_READINESS.DEBUGGER_CONFLICT);
        }
        const target = message.sessionId
          ? { tabId: message.tabId, sessionId: message.sessionId }
          : { tabId: message.tabId };
        const result = await chrome.debugger.sendCommand(
          target,
          message.method,
          message.params ?? {}
        );
        send({ type: "result", seq, result: result ?? {} });
        return;
      }
      case "createTab": {
        const url = validateShareableTabUrl(message.url);
        const tab = await chrome.tabs.create({
          url: "about:blank",
          active: message.background !== true
        });
        await addTabToOpenClawGroup(tab.id);
        await attachDebugger(tab.id);
        await chrome.tabs.update(tab.id, { url });
        scheduleTabsSync();
        send({ type: "result", seq, result: { tabId: tab.id } });
        return;
      }
      case "closeTab":
        await detachDebugger(message.tabId);
        await chrome.tabs.remove(message.tabId);
        send({ type: "result", seq, result: {} });
        return;
      case "activateTab": {
        const tab = await chrome.tabs.get(message.tabId);
        await chrome.tabs.update(message.tabId, { active: true });
        if (typeof tab.windowId === "number") {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        send({ type: "result", seq, result: {} });
        return;
      }
      default:
        if (typeof seq === "number") {
          send({ type: "error", seq, message: "unknown_relay_command" });
        }
    }
  } catch (error) {
    if (typeof seq === "number") {
      const code =
        error instanceof PreparedTabError ? error.code : classifyDebuggerAttachError(error);
      send({ type: "error", seq, message: code });
    }
  }
}

async function sendHello() {
  const { ready } = await readySharedTabs();
  const userAgentMatch = /Chrom(?:e|ium)\/[\d.]+/u.exec(navigator.userAgent);
  send({
    type: "hello",
    userAgent: navigator.userAgent,
    browserVersion: userAgentMatch ? userAgentMatch[0] : "Chrome/unknown",
    extensionVersion: chrome.runtime.getManifest().version,
    tabs: ready.map(toRelayTabInfo)
  });
}

async function connectRelay() {
  const { relayUrl, token } = await getConfig();
  if (!relayUrl || !token) {
    setBadge("off");
    return;
  }
  if (
    relayWs &&
    (relayWs.readyState === WebSocket.OPEN || relayWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  setBadge("connecting");
  let socket;
  try {
    socket = new WebSocket(relayUrl, buildRelayWsProtocols(token));
  } catch {
    setBadge("error");
    scheduleReconnect();
    return;
  }
  relayWs = socket;
  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setBadge("on");
    void sendHello();
  });
  socket.addEventListener("message", (event) => {
    try {
      void handleRelayCommand(JSON.parse(String(event.data)));
    } catch {
      // Invalid relay frames are ignored without echoing content.
    }
  });
  socket.addEventListener("close", () => {
    if (relayWs === socket) {
      relayWs = null;
      setBadge("error");
      scheduleReconnect();
    }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectRelay();
  }, delay);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message?.type) {
        case "getStatus": {
          const { relayUrl } = await getConfig();
          const { installationDigest } = await getInstallationIdentity();
          const { shared, ready } = await readySharedTabs();
          const readiness = deriveTabReadiness({
            sharedTabCount: shared.length,
            ownedAttachedTabCount: ready.length,
            lastReadiness: tabReadiness
          });
          sendResponse({
            paired: Boolean(relayUrl),
            state: relayState,
            sharedTabCount: shared.length,
            readiness,
            extensionVersion: EXTENSION_VERSION,
            enrollmentProtocolVersion: ENROLLMENT_PROTOCOL_VERSION,
            installationDigest
          });
          return;
        }
        case "getEnrollmentIdentity": {
          const { installationDigest } = await getInstallationIdentity();
          sendResponse({
            ok: true,
            extensionVersion: EXTENSION_VERSION,
            enrollmentProtocolVersion: ENROLLMENT_PROTOCOL_VERSION,
            installationDigest
          });
          return;
        }
        case "enroll": {
          let requestId =
            typeof message.request?.requestId === "string" ? message.request.requestId : null;
          try {
            const request = parseEnrollmentRequest(message.request);
            requestId = request.requestId;
            const { installationId } = await getInstallationIdentity();
            const enrolled = await enrollWithGateway(request, { installationId });
            await chrome.storage.local.set({
              relayUrl: enrolled.relayUrl,
              token: enrolled.token,
              groupColor: "orange"
            });
            reconnectAttempt = 0;
            relayWs?.close();
            relayWs = null;
            await connectRelay();
            sendResponse({ ok: true, requestId, state: "connected" });
          } catch (error) {
            sendResponse({
              ok: false,
              ...(requestId ? { requestId } : {}),
              state: enrollmentFailureState(error)
            });
          }
          return;
        }
        case "pair": {
          const parsed = parsePairingString(message.pairingString);
          if (!parsed) {
            sendResponse({ ok: false, error: "invalid_pairing_string" });
            return;
          }
          await chrome.storage.local.set({
            relayUrl: parsed.relayUrl,
            token: parsed.token,
            groupColor: nearestGroupColor(message.groupColor)
          });
          reconnectAttempt = 0;
          relayWs?.close();
          relayWs = null;
          await connectRelay();
          sendResponse({ ok: true });
          return;
        }
        case "unpair":
          await revokeSharedTabs();
          await chrome.storage.local.remove(["relayUrl", "token"]);
          relayWs?.close();
          relayWs = null;
          setBadge("off");
          sendResponse({ ok: true });
          return;
        case "prepareSearchTab": {
          tabReadiness = TAB_READINESS.PREPARING;
          const result = await prepareDedicatedSearchTab(preparedDependencies());
          tabReadiness = result.readiness;
          sendResponse({ ok: true, ...result });
          return;
        }
        case "toggleShareTab": {
          const tabId = message.tabId;
          if (typeof tabId !== "number") {
            sendResponse({ ok: false, error: TAB_READINESS.TAB_NOT_SHAREABLE });
            return;
          }
          if (await isTabShared(tabId)) {
            await detachDebugger(tabId);
            await removeTabFromOpenClawGroup(tabId);
            tabReadiness = TAB_READINESS.NOT_SHARED;
            await syncTabsToRelay();
            sendResponse({ ok: true, shared: false, readiness: tabReadiness });
          } else {
            const tab = await chrome.tabs.get(tabId);
            const result = await shareExistingTab(tab, preparedDependencies());
            tabReadiness = result.readiness;
            sendResponse({ ok: true, shared: true, readiness: result.readiness });
          }
          return;
        }
        case "isTabShared":
          sendResponse({ shared: await isTabShared(message.tabId) });
          return;
        default:
          sendResponse({ ok: false, error: "unknown_message" });
      }
    } catch (error) {
      const code =
        error instanceof PreparedTabError ? error.code : classifyDebuggerAttachError(error);
      tabReadiness = code;
      sendResponse({ ok: false, error: code });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  scheduleTabsSync();
});
chrome.tabs.onUpdated.addListener(() => scheduleTabsSync());
chrome.tabGroups.onUpdated.addListener(() => scheduleTabsSync());
chrome.tabGroups.onRemoved.addListener(() => scheduleTabsSync());

chrome.alarms.create("openclaw-relay-watchdog", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "openclaw-relay-watchdog") void connectRelay();
});
chrome.runtime.onStartup.addListener(() => void connectRelay());
chrome.runtime.onInstalled.addListener(() => {
  void getInstallationIdentity();
  void connectRelay();
});

void getInstallationIdentity();
void connectRelay();

// Kept as a named constant in this runtime so release verification can assert the
// only extension-owned navigation target without parsing implementation details.
void PREPARED_SEARCH_START_URL;
