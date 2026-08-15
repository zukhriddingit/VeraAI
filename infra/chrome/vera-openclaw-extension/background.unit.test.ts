import { beforeAll, describe, expect, it, vi } from "vitest";

type RuntimeMessageListener = (
  message: Record<string, unknown>,
  sender: unknown,
  respond: (response: unknown) => void
) => boolean;

const calls: string[] = [];
const storageState: Record<string, unknown> = {};
const sockets: FakeWebSocket[] = [];
let nextEnrollmentResponse: Record<string, unknown> = {
  protocol: "vera-browser-enrollment.v1",
  token: "d".repeat(64)
};
const tabs = new Map<
  number,
  { id: number; url: string; title: string; windowId: number; status: string }
>([
  [
    5,
    {
      id: 5,
      url: "https://www.apartments.com/boston-ma/",
      title: "Boston apartments",
      windowId: 1,
      status: "complete"
    }
  ]
]);
const grouped = new Set<number>([5]);
const attached = new Set<number>([5]);
let runtimeMessageListener: RuntimeMessageListener | null = null;
let backgroundModule: {
  handleRelayCommand(message: Record<string, unknown>): Promise<void>;
  handleDebuggerDetach(source: { tabId?: number }, reason: string): Promise<void>;
};

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readonly listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  readonly protocol: string;
  readyState = FakeWebSocket.CONNECTING;

  constructor(
    readonly url: string,
    protocols: string | string[]
  ) {
    this.protocol = Array.isArray(protocols) ? (protocols[0] ?? "") : protocols;
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    });
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(value: string) {
    calls.push(`socket:${this.protocol}:send`);
    if (this.protocol === "vera-browser-enrollment.v1") {
      expect(JSON.parse(value)).toMatchObject({
        ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
        installationId: expect.stringMatching(/^[a-f0-9]{64}$/u)
      });
      queueMicrotask(() => this.emit("message", { data: JSON.stringify(nextEnrollmentResponse) }));
    }
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

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
      get: vi.fn(async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((key) => key in storageState).map((key) => [key, storageState[key]])
        )
      ),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.assign(storageState, values);
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const key of keys) delete storageState[key];
      })
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
      const tab = { id: 9, url: "about:blank", title: "", windowId: 1, status: "complete" };
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
      if (tab && update.url) {
        tab.url = update.url;
        tab.status = "complete";
      }
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
    getManifest: vi.fn(() => ({ version: "2.2.0" })),
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
  vi.stubGlobal("WebSocket", FakeWebSocket);
  backgroundModule = await import("./background.js");
});

describe("Vera OpenClaw background lifecycle", () => {
  it("creates one persistent installation identity and exposes only its digest", async () => {
    const first = (await message({ type: "getStatus" })) as Record<string, unknown>;
    const installationId = storageState.installationId;
    const second = (await message({ type: "getEnrollmentIdentity" })) as Record<string, unknown>;

    expect(installationId).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).toMatchObject({
      extensionVersion: "2.2.0",
      enrollmentProtocolVersion: "1",
      installationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(second.installationDigest).toBe(first.installationDigest);
    expect(JSON.stringify(first)).not.toContain(String(installationId));
    expect(JSON.stringify(second)).not.toContain(String(installationId));
    expect(chromeMock.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it("reconciles an owned debugger lease after a worker restart", async () => {
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "ready",
      sharedTabCount: 1
    });
    expect(calls).toContain("command:5:Runtime.enable");
  });

  it("navigates the blank replacement before attaching it", async () => {
    calls.length = 0;
    await expect(message({ type: "prepareSearchTab" })).resolves.toMatchObject({
      ok: true,
      readiness: "ready",
      tabId: 9
    });
    expect(
      calls.indexOf("navigate:9:https://www.zillow.com/homes/for_rent/")
    ).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("attach:9")).toBeGreaterThan(
      calls.indexOf("navigate:9:https://www.zillow.com/homes/for_rent/")
    );
    expect(grouped).toEqual(new Set([9]));
    expect(attached).toEqual(new Set([9]));
  });

  it("preserves the prepared debugger lease when a bounded relay session detaches", async () => {
    calls.length = 0;
    await backgroundModule.handleRelayCommand({ type: "detach", tabId: 9, seq: 1 });

    expect(calls).not.toContain("detach:9");
    expect(grouped).toEqual(new Set([9]));
    expect(attached).toEqual(new Set([9]));
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "ready",
      sharedTabCount: 1
    });
  });

  it("recovers a transient target replacement without revoking consent", async () => {
    calls.length = 0;
    attached.delete(9);

    await backgroundModule.handleDebuggerDetach({ tabId: 9 }, "target_closed");

    expect(calls).toContain("attach:9");
    expect(calls).not.toContain("ungroup:9");
    expect(grouped).toEqual(new Set([9]));
    expect(attached).toEqual(new Set([9]));
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "ready",
      sharedTabCount: 1
    });
  });

  it("still revokes consent when DevTools replaces the owned debugger", async () => {
    calls.length = 0;
    attached.delete(9);

    await backgroundModule.handleDebuggerDetach({ tabId: 9 }, "replaced_with_devtools");

    expect(calls).not.toContain("attach:9");
    expect(calls).toContain("ungroup:9");
    expect(grouped.size).toBe(0);
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "debugger_conflict",
      sharedTabCount: 0
    });
  });

  it("still revokes the debugger lease when the user explicitly stops sharing", async () => {
    await message({ type: "prepareSearchTab" });
    calls.length = 0;
    await expect(message({ type: "toggleShareTab", tabId: 9 })).resolves.toMatchObject({
      ok: true,
      shared: false,
      readiness: "not_shared"
    });

    expect(calls).toContain("detach:9");
    expect(calls).toContain("ungroup:9");
    expect(grouped.size).toBe(0);
    expect(attached.size).toBe(0);
  });

  it("does not report ready after Chrome drops the debugger lease", async () => {
    await message({ type: "prepareSearchTab" });
    attached.delete(9);
    await expect(message({ type: "getStatus" })).resolves.toMatchObject({
      readiness: "attachment_failed",
      sharedTabCount: 1
    });
  });

  it("enrolls persistently without sharing, grouping, or attaching another tab", async () => {
    const callOffset = calls.length;
    const requestId = "10000000-0000-4000-8000-000000000013";

    await expect(
      message({
        type: "enroll",
        request: {
          source: "vera-web",
          type: "connect-browser",
          version: "1",
          requestId,
          confirmation: "connect_read_only_browser",
          ticket: "A".repeat(43),
          expiresAt: "2099-08-14T12:01:00.000Z",
          gatewayOrigin: "https://gateway-a.verahousing.app",
          protocolVersion: "1"
        }
      })
    ).resolves.toEqual({ ok: true, requestId, state: "connected" });

    expect(storageState).toMatchObject({
      installationId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      relayUrl: "wss://gateway-a.verahousing.app/browser/extension",
      token: "d".repeat(64)
    });
    expect(sockets.some((socket) => socket.protocol === "vera-browser-enrollment.v1")).toBe(true);
    expect(sockets.some((socket) => socket.protocol === "openclaw-extension-relay")).toBe(true);
    const enrollmentCalls = calls.slice(callOffset);
    expect(enrollmentCalls.some((call) => call.startsWith("group:"))).toBe(false);
    expect(enrollmentCalls.some((call) => call.startsWith("attach:"))).toBe(false);
  });

  it("unpair removes transport secrets while retaining the non-secret installation identity", async () => {
    const installationId = storageState.installationId;

    await expect(message({ type: "unpair" })).resolves.toEqual({ ok: true });

    expect(storageState.installationId).toBe(installationId);
    expect(storageState).not.toHaveProperty("relayUrl");
    expect(storageState).not.toHaveProperty("token");
  });

  it("stores no relay material after a denied enrollment", async () => {
    nextEnrollmentResponse = {
      protocol: "vera-browser-enrollment.v1",
      error: "ticket_replayed"
    };

    await expect(
      message({
        type: "enroll",
        request: {
          source: "vera-web",
          type: "connect-browser",
          version: "1",
          requestId: "20000000-0000-4000-8000-000000000013",
          confirmation: "connect_read_only_browser",
          ticket: "B".repeat(43),
          expiresAt: "2099-08-14T12:01:00.000Z",
          gatewayOrigin: "https://gateway-a.verahousing.app",
          protocolVersion: "1"
        }
      })
    ).resolves.toMatchObject({ ok: false, state: "denied" });
    expect(storageState).not.toHaveProperty("relayUrl");
    expect(storageState).not.toHaveProperty("token");
  });
});
