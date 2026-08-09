import { describe, expect, it, vi } from "vitest";

import {
  PREPARED_SEARCH_START_URL,
  PreparedTabError,
  TAB_READINESS,
  classifyDebuggerAttachError,
  deriveTabReadiness,
  prepareDedicatedSearchTab,
  shareExistingTab,
  validateShareableTabUrl
} from "./prepared-tab.js";

function harness(options: { attachError?: Error; existing?: Array<{ id: number }> } = {}) {
  const calls: string[] = [];
  const dependencies = {
    listSharedTabs: vi.fn(async () => {
      calls.push("list");
      return options.existing ?? [{ id: 7 }];
    }),
    createBlankTab: vi.fn(async () => {
      calls.push("create:about:blank");
      return { id: 9 };
    }),
    groupTab: vi.fn(async (tabId: number) => {
      calls.push(`group:${tabId}`);
    }),
    attachTab: vi.fn(async (tabId: number) => {
      calls.push(`attach:${tabId}`);
      if (options.attachError) throw options.attachError;
    }),
    navigateTab: vi.fn(async (tabId: number, url: string) => {
      calls.push(`navigate:${tabId}:${url}`);
    }),
    detachTab: vi.fn(async (tabId: number) => {
      calls.push(`detach:${tabId}`);
    }),
    ungroupTab: vi.fn(async (tabId: number) => {
      calls.push(`ungroup:${tabId}`);
    }),
    closeTab: vi.fn(async (tabId: number) => {
      calls.push(`close:${tabId}`);
    }),
    syncTabs: vi.fn(async () => {
      calls.push("sync");
    })
  };
  return { calls, dependencies };
}

describe("prepareDedicatedSearchTab", () => {
  it("revokes old consent and attaches the blank tab before navigation", async () => {
    const { calls, dependencies } = harness();
    await expect(prepareDedicatedSearchTab(dependencies)).resolves.toEqual({
      tabId: 9,
      readiness: "ready"
    });
    expect(calls).toEqual([
      "list",
      "detach:7",
      "ungroup:7",
      "create:about:blank",
      "group:9",
      "attach:9",
      `navigate:9:${PREPARED_SEARCH_START_URL}`,
      "sync"
    ]);
  });

  it("cleans up a failed blank tab and exposes only a typed conflict", async () => {
    const { calls, dependencies } = harness({
      attachError: new Error(
        "Cannot access a chrome-extension:// URL of different extension secret-extension-id"
      )
    });
    const error = await prepareDedicatedSearchTab(dependencies).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PreparedTabError);
    expect(error).toMatchObject({ code: TAB_READINESS.BROWSER_EXTENSION_CONFLICT });
    expect(String(error)).not.toContain("secret-extension-id");
    expect(calls).toContain("detach:9");
    expect(calls).toContain("ungroup:9");
    expect(calls).toContain("close:9");
    expect(calls.some((entry) => entry.startsWith("navigate:"))).toBe(false);
  });
});

describe("shareExistingTab", () => {
  it("preflights an eligible tab and replaces any previous consent", async () => {
    const { calls, dependencies } = harness({ existing: [{ id: 7 }] });
    await shareExistingTab({ id: 11, url: "https://www.apartments.com/boston-ma/" }, dependencies);
    expect(calls).toEqual(["list", "detach:7", "ungroup:7", "group:11", "attach:11", "sync"]);
  });

  it("rejects restricted pages before changing consent", async () => {
    const { calls, dependencies } = harness();
    await expect(
      shareExistingTab(
        { id: 11, url: "chrome-extension://another-extension/page.html" },
        dependencies
      )
    ).rejects.toMatchObject({ code: TAB_READINESS.TAB_NOT_SHAREABLE });
    expect(calls).toEqual([]);
  });
});

describe("prepared tab safety helpers", () => {
  it("classifies general debugger conflicts without naming another extension", () => {
    expect(
      classifyDebuggerAttachError(
        new Error("Cannot access a chrome-extension:// URL of different extension")
      )
    ).toBe(TAB_READINESS.BROWSER_EXTENSION_CONFLICT);
    expect(classifyDebuggerAttachError(new Error("Another debugger is already attached"))).toBe(
      TAB_READINESS.DEBUGGER_CONFLICT
    );
  });

  it("reconciles MV3 restarts without a false-ready state", () => {
    expect(
      deriveTabReadiness({
        sharedTabCount: 1,
        ownedAttachedTabCount: 1,
        lastReadiness: TAB_READINESS.NOT_SHARED
      })
    ).toBe(TAB_READINESS.READY);
    expect(
      deriveTabReadiness({
        sharedTabCount: 1,
        ownedAttachedTabCount: 0,
        lastReadiness: TAB_READINESS.READY
      })
    ).toBe(TAB_READINESS.ATTACHMENT_FAILED);
    expect(
      deriveTabReadiness({
        sharedTabCount: 2,
        ownedAttachedTabCount: 1,
        lastReadiness: TAB_READINESS.READY
      })
    ).toBe(TAB_READINESS.MULTIPLE_SHARED_TABS);
  });

  it("accepts only credential-free HTTPS pages for manual sharing", () => {
    expect(
      validateShareableTabUrl("https://www.facebook.com/marketplace/boston/propertyrentals/")
    ).toBe("https://www.facebook.com/marketplace/boston/propertyrentals/");
    expect(() => validateShareableTabUrl("http://example.com/")).toThrowError(PreparedTabError);
    expect(() => validateShareableTabUrl("https://user:pass@example.com/")).toThrowError(
      PreparedTabError
    );
  });
});
