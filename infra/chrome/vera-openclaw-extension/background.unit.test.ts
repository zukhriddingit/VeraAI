import { beforeAll, describe, expect, it, vi } from "vitest";

type RuntimeMessageListener = (
  message: Record<string, unknown>,
  sender: unknown,
  respond: (response: unknown) => void
) => boolean;

const calls: string[] = [];
const tabs = new Map<number, { id: number; url: string; title: string; windowId: number }>([
  [
    5,
    {
      id: 5,
      url: "https://www.apartments.com/boston-ma/",
      title: "Boston apartments",
      windowId: 1
    }
  ]
]);
const grouped = new Set<number>([5]);
const attached = new Set<number>([5]);
let runtimeMessageListener: RuntimeMessageListener | null = null;

function eventHook<T extends (...arguments_: never[]) => unknown>() {
  return { addListener: vi.fn((_listener: T) => undefined) };
}

const chromeMock = {
  action: {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined)
  },
  storage: {
    local: {
      get: vi.fn(async () => ({ relayUrl: "", token: "", groupColor: "orange" })),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
  },
  tabGroups: {
    query: vi.fn(async () => (grouped.size > 0 ? [{ id: 1, windowId: 1, title: "OpenClaw" }] : [])),
    update: vi.fn(async () => undefined),
    onUpdated: eventHook(),
    onRemoved: eventHook()
  },
  tabs: {
    query: vi.fn(async () => [...grouped].map((tabId) => tabs.get(tabId))),
    get: vi.fn(async (tabId: number) => tabs.get(tabId)),
    create: vi.fn(async () => {
      calls.push("create:about:blank");
      const tab = { id: 9, url: "about:blank", title: "", windowId: 1 };
      tabs.set(9, tab);
      return tab;
    }),
    group: vi.fn(async ({ tabIds }: { tabIds: number[] }) => {
      for (const tabId of tabIds) grouped.add(tabId);
      calls.push(`group:${tabIds.join(",")}`);
      return 1;
    }),
    ungroup: vi.fn(async (tabIds: number[]) => {
      for (const tabId of tabIds) grouped.delete(tabId);
      calls.push(`ungroup:${tabIds.join(",")}`);
    }),
    update: vi.fn(async (tabId: number, update: { url?: string }) => {
      const tab = tabs.get(tabId);
      if (tab && update.url) tab.url = update.url;
      calls.push(`navigate:${tabId}:${update.url ?? ""}`);
      return tab;
    }),
    remove: vi.fn(async (tabId: number) => {
      tabs.delete(tabId);
      grouped.delete(tabId);
      calls.push(`close:${tabId}`);
    }),
    onRemoved: eventHook(),
    onUpdated: eventHook()
  },
  debugger: {
    getTargets: vi.fn(async () =>
      [...attached].map((tabId) => ({ id: `target-${tabId}`, tabId, attached: true }))
    ),
    sendCommand: vi.fn(async ({ tabId }: { tabId: number }, method: string) => {
      if (!attached.has(tabId)) throw new Error("Debugger is not attached");
      calls.push(`command:${tabId}:${method}`);
      return {};
    }),
    attach: vi.fn(async ({ tabId }: { tabId: number }) => {
      calls.push(`attach:${tabId}`);
      attached.add(tabId);
    }),
    detach: vi.fn(async ({ tabId }: { tabId: number }) => {
      calls.push(`detach:${tabId}`);
      attached.delete(tabId);
    }),
    onEvent: eventHook(),
    onDetach: eventHook()
  },
  runtime: {
    getManifest: vi.fn(() => ({ version: "2.0.1" })),
    onMessage: {
      addListener: vi.fn((listener: RuntimeMessageListener) => {
        runtimeMessageListener = listener;
      })
    },
    onStartup: eventHook(),
    onInstalled: eventHook()
  },
  windows: { update: vi.fn(async () => undefined) },
  alarms: { create: vi.fn(), onAlarm: eventHook() }
};

async function message(message: Record<string, unknown>) {
  if (runtimeMessageListener === null) throw new Error("background listener not registered");
  return new Promise<unknown>((resolve) => {
    runtimeMessageListener?.(message, {}, resolve);
  });
}

beforeAll(async () => {
  vi.stubGlobal("chrome", chromeMock);
  await import("./background.js");
});

describe("Vera OpenClaw background lifecycle", () => {
  it("reconciles an owned debugger lease after a worker restart", async () => {
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "ready",
      sharedTabCount: 1
    });
    expect(calls).toContain("command:5:Runtime.enable");
  });

  it("attaches the blank replacement before navigating it", async () => {
    calls.length = 0;
    await expect(message({ type: "prepareSearchTab" })).resolves.toMatchObject({
      ok: true,
      readiness: "ready",
      tabId: 9
    });
    expect(calls.indexOf("attach:9")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("navigate:9:https://www.zillow.com/homes/for_rent/")).toBeGreaterThan(
      calls.indexOf("attach:9")
    );
    expect(grouped).toEqual(new Set([9]));
    expect(attached).toEqual(new Set([9]));
  });

  it("does not report ready after Chrome drops the debugger lease", async () => {
    attached.delete(9);
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "attachment_failed",
      sharedTabCount: 1
    });
  });
});
