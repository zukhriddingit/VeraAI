export const PREPARED_SEARCH_START_URL = "https://www.zillow.com/homes/for_rent/";

export const TAB_READINESS = Object.freeze({
  NOT_SHARED: "not_shared",
  PREPARING: "preparing",
  READY: "ready",
  BROWSER_EXTENSION_CONFLICT: "browser_extension_conflict",
  DEBUGGER_CONFLICT: "debugger_conflict",
  MULTIPLE_SHARED_TABS: "multiple_shared_tabs",
  TAB_NOT_SHAREABLE: "tab_not_shareable",
  ATTACHMENT_FAILED: "attachment_failed"
});

export function deriveTabReadiness({ sharedTabCount, ownedAttachedTabCount, lastReadiness }) {
  if (sharedTabCount > 1) return TAB_READINESS.MULTIPLE_SHARED_TABS;
  if (sharedTabCount === 1 && ownedAttachedTabCount === 1) return TAB_READINESS.READY;
  if (sharedTabCount === 1) {
    return lastReadiness === TAB_READINESS.PREPARING
      ? TAB_READINESS.PREPARING
      : lastReadiness === TAB_READINESS.BROWSER_EXTENSION_CONFLICT ||
          lastReadiness === TAB_READINESS.DEBUGGER_CONFLICT
        ? lastReadiness
        : TAB_READINESS.ATTACHMENT_FAILED;
  }
  if (
    lastReadiness === TAB_READINESS.BROWSER_EXTENSION_CONFLICT ||
    lastReadiness === TAB_READINESS.DEBUGGER_CONFLICT ||
    lastReadiness === TAB_READINESS.PREPARING
  ) {
    return lastReadiness;
  }
  return TAB_READINESS.NOT_SHARED;
}

export class PreparedTabError extends Error {
  constructor(code) {
    super(code);
    this.name = "PreparedTabError";
    this.code = code;
  }
}

export function classifyDebuggerAttachError(error) {
  const message = String(error instanceof Error ? error.message : (error ?? ""));
  if (
    message.includes("chrome-extension:// URL of different extension") ||
    message.includes("Cannot access a chrome:// URL") ||
    message.includes("Cannot attach to this target")
  ) {
    return TAB_READINESS.BROWSER_EXTENSION_CONFLICT;
  }
  if (
    message.includes("Another debugger is already attached") ||
    message.includes("Debugger is not attached") ||
    message.includes("DevTools")
  ) {
    return TAB_READINESS.DEBUGGER_CONFLICT;
  }
  return TAB_READINESS.ATTACHMENT_FAILED;
}

export function validateShareableTabUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error("restricted");
    }
    return url.href;
  } catch {
    throw new PreparedTabError(TAB_READINESS.TAB_NOT_SHAREABLE);
  }
}

async function revokeTabs(tabs, dependencies, exceptTabId = null) {
  for (const tab of tabs) {
    if (typeof tab.id !== "number" || tab.id === exceptTabId) continue;
    await dependencies.detachTab(tab.id);
    await dependencies.ungroupTab(tab.id);
  }
}

export async function prepareDedicatedSearchTab(dependencies) {
  const existing = await dependencies.listSharedTabs();
  await revokeTabs(existing, dependencies);
  const tab = await dependencies.createBlankTab();
  if (!tab || typeof tab.id !== "number") {
    throw new PreparedTabError(TAB_READINESS.ATTACHMENT_FAILED);
  }
  let grouped = false;
  try {
    await dependencies.groupTab(tab.id);
    grouped = true;
    await dependencies.navigateTab(tab.id, PREPARED_SEARCH_START_URL);
    await dependencies.waitForTabReady(tab.id, PREPARED_SEARCH_START_URL);
    await dependencies.attachTab(tab.id);
    await dependencies.syncTabs();
    return Object.freeze({ tabId: tab.id, readiness: TAB_READINESS.READY });
  } catch (error) {
    await dependencies.detachTab(tab.id);
    if (grouped) await dependencies.ungroupTab(tab.id);
    await dependencies.closeTab(tab.id);
    if (error instanceof PreparedTabError) throw error;
    throw new PreparedTabError(classifyDebuggerAttachError(error));
  }
}

export async function shareExistingTab(tab, dependencies) {
  if (!tab || typeof tab.id !== "number") {
    throw new PreparedTabError(TAB_READINESS.TAB_NOT_SHAREABLE);
  }
  validateShareableTabUrl(tab.url ?? "");
  const existing = await dependencies.listSharedTabs();
  await revokeTabs(existing, dependencies, tab.id);
  let grouped = existing.some((candidate) => candidate.id === tab.id);
  try {
    if (!grouped) {
      await dependencies.groupTab(tab.id);
      grouped = true;
    }
    await dependencies.attachTab(tab.id);
    await dependencies.syncTabs();
    return Object.freeze({ tabId: tab.id, readiness: TAB_READINESS.READY });
  } catch (error) {
    await dependencies.detachTab(tab.id);
    if (grouped) await dependencies.ungroupTab(tab.id);
    if (error instanceof PreparedTabError) throw error;
    throw new PreparedTabError(classifyDebuggerAttachError(error));
  }
}
