export const PREPARED_SEARCH_START_URL: string;
export const TAB_READINESS: Readonly<{
  NOT_SHARED: "not_shared";
  PREPARING: "preparing";
  READY: "ready";
  BROWSER_EXTENSION_CONFLICT: "browser_extension_conflict";
  DEBUGGER_CONFLICT: "debugger_conflict";
  MULTIPLE_SHARED_TABS: "multiple_shared_tabs";
  TAB_NOT_SHAREABLE: "tab_not_shareable";
  ATTACHMENT_FAILED: "attachment_failed";
}>;
export class PreparedTabError extends Error {
  readonly code: string;
}
export function classifyDebuggerAttachError(error: unknown): string;
export function validateShareableTabUrl(rawUrl: unknown): string;
export function deriveTabReadiness(input: {
  sharedTabCount: number;
  ownedAttachedTabCount: number;
  lastReadiness: string;
}): string;
export function prepareDedicatedSearchTab(dependencies: PreparedTabDependencies): Promise<{
  tabId: number;
  readiness: "ready";
}>;
export function shareExistingTab(
  tab: { id?: number; url?: string },
  dependencies: PreparedTabDependencies
): Promise<{ tabId: number; readiness: "ready" }>;
interface PreparedTabDependencies {
  listSharedTabs(): Promise<Array<{ id?: number }>>;
  createBlankTab(): Promise<{ id?: number }>;
  groupTab(tabId: number): Promise<void>;
  attachTab(tabId: number): Promise<unknown>;
  navigateTab(tabId: number, url: string): Promise<unknown>;
  waitForTabReady(tabId: number, url: string): Promise<void>;
  detachTab(tabId: number): Promise<void>;
  ungroupTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  syncTabs(): Promise<void>;
}
