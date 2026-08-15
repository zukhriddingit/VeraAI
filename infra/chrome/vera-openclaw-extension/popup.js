/* global chrome */

import { CONSENT_DISCLOSURE, shareButtonLabel } from "./modules/popup-copy.js";

const statusDot = document.getElementById("statusDot");
const pairSection = document.getElementById("pairSection");
const connectedSection = document.getElementById("connectedSection");
const prepareButton = document.getElementById("prepareButton");
const shareButton = document.getElementById("shareButton");
const unpairButton = document.getElementById("unpairButton");
const connectionLine = document.getElementById("connectionLine");
const readinessLine = document.getElementById("readinessLine");
const errorLine = document.getElementById("error");
const consentDisclosure = document.getElementById("consentDisclosure");

consentDisclosure.textContent = CONSENT_DISCLOSURE;

const CONNECTION_LABEL = {
  on: "Connected to the Vera Browser Gateway",
  connecting: "Connecting to the Vera Browser Gateway…",
  error: "Gateway connection unavailable",
  off: "Not connected"
};

const READINESS_LABEL = {
  not_shared: "Prepare one dedicated Vera Search tab before searching.",
  preparing: "Preparing a clean consented browser tab…",
  ready: "Browser ready — keep this tab shared while Vera searches.",
  browser_extension_conflict:
    "Another browser extension is present in that tab. Prepare a clean Vera Search tab.",
  debugger_conflict:
    "Another debugger or DevTools session owns that tab. Close it, then prepare a clean tab.",
  multiple_shared_tabs: "More than one tab is shared. Prepare one clean Vera Search tab.",
  tab_not_shareable: "That page cannot be shared. Use Prepare Vera Search tab.",
  attachment_failed: "Chrome could not prepare the tab. Try Prepare Vera Search tab again."
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

function showError(message) {
  errorLine.textContent = READINESS_LABEL[message] ?? "The browser tab could not be prepared.";
  errorLine.classList.remove("hidden");
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "getStatus" });
  statusDot.className = `dot ${status.state}`;
  pairSection.classList.toggle("hidden", status.paired);
  connectedSection.classList.toggle("hidden", !status.paired);
  if (!status.paired) return;
  connectionLine.textContent = CONNECTION_LABEL[status.state] ?? CONNECTION_LABEL.off;
  readinessLine.textContent = READINESS_LABEL[status.readiness] ?? READINESS_LABEL.not_shared;
  prepareButton.textContent =
    status.readiness === "ready"
      ? "Replace with a clean Vera Search tab"
      : "Prepare Vera Search tab";
  const tab = await activeTab();
  if (tab?.id === undefined) {
    shareButton.classList.add("hidden");
    return;
  }
  const result = await chrome.runtime.sendMessage({ type: "isTabShared", tabId: tab.id });
  shareButton.classList.remove("hidden");
  shareButton.textContent = shareButtonLabel(result.shared);
  shareButton.dataset.tabId = String(tab.id);
}

prepareButton.addEventListener("click", () => {
  void (async () => {
    errorLine.classList.add("hidden");
    const result = await chrome.runtime.sendMessage({ type: "prepareSearchTab" });
    if (!result.ok) showError(result.error);
    await refresh();
  })();
});

shareButton.addEventListener("click", () => {
  void (async () => {
    errorLine.classList.add("hidden");
    const tabId = Number.parseInt(shareButton.dataset.tabId ?? "", 10);
    if (!Number.isFinite(tabId)) return;
    const result = await chrome.runtime.sendMessage({ type: "toggleShareTab", tabId });
    if (!result.ok) showError(result.error);
    await refresh();
  })();
});

unpairButton.addEventListener("click", () => {
  void (async () => {
    await chrome.runtime.sendMessage({ type: "unpair" });
    await refresh();
  })();
});

void refresh();
setInterval(() => void refresh(), 2_000);
