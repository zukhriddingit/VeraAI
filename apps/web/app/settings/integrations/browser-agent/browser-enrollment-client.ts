import {
  BrowserExtensionEnrollmentResultMessageSchema,
  BrowserExtensionReadinessMessageV2Schema,
  CreateBrowserConnectorEnrollmentResponseSchema,
  type BrowserExtensionReadinessMessage,
  type BrowserGatewayOnboardingStatus
} from "@vera/domain";

export type BrowserConnectionAction = "install" | "onboarding" | "connect" | "connected";
export type BrowserEnrollmentFailureCode =
  | "assignment_unavailable"
  | "device_conflict"
  | "rate_limited"
  | "expired"
  | "denied"
  | "unavailable"
  | "version_incompatible";

export class BrowserEnrollmentClientError extends Error {
  constructor(readonly code: BrowserEnrollmentFailureCode) {
    super(browserEnrollmentRecovery(code));
    this.name = "BrowserEnrollmentClientError";
  }
}

export function connectionAction(input: {
  readonly extension: BrowserExtensionReadinessMessage | null;
  readonly assignment: BrowserGatewayOnboardingStatus | null;
}): BrowserConnectionAction {
  if (input.extension?.version !== "2") return "install";
  if (input.assignment?.status !== "active") return "onboarding";
  return input.extension.paired ? "connected" : "connect";
}

export function browserEnrollmentRecovery(code: BrowserEnrollmentFailureCode): string {
  switch (code) {
    case "assignment_unavailable":
      return "Your isolated Browser Connector assignment is not active yet.";
    case "device_conflict":
      return "Another Chrome profile is connected. Revoke it before connecting this browser.";
    case "rate_limited":
      return "A connection attempt is already active. Wait one minute, then try again.";
    case "expired":
      return "The one-time connection expired. Choose Connect this browser again.";
    case "version_incompatible":
      return "Update the Vera Browser Connector, then try again.";
    case "denied":
      return "The one-time connection was denied. Request a fresh connection.";
    case "unavailable":
      return "The Browser Gateway is temporarily unavailable. Your browser remains disconnected.";
  }
}

interface BrowserEnrollmentWindow {
  readonly location: { readonly origin: string };
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
  setTimeout(handler: () => void, milliseconds: number): number;
  clearTimeout(timer: number): void;
}

interface ConnectBrowserDependencies {
  readonly fetchImplementation?: typeof fetch;
  readonly windowImplementation?: BrowserEnrollmentWindow;
  readonly randomUUID?: () => string;
  readonly digest?: (value: string) => Promise<string>;
  readonly timeoutMilliseconds?: number;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicFailureCode(value: unknown): BrowserEnrollmentFailureCode {
  if (value && typeof value === "object" && "code" in value) {
    const code = (value as { readonly code?: unknown }).code;
    if (
      code === "assignment_unavailable" ||
      code === "device_conflict" ||
      code === "rate_limited" ||
      code === "version_incompatible"
    ) {
      return code;
    }
  }
  return "unavailable";
}

function waitForEnrollmentResult(input: {
  readonly requestId: string;
  readonly browserWindow: BrowserEnrollmentWindow;
  readonly timeoutMilliseconds: number;
}): Promise<"connected"> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.browserWindow.removeEventListener("message", listener);
      input.browserWindow.clearTimeout(timer);
    };
    const listener = (event: MessageEvent<unknown>) => {
      if (
        event.source !== input.browserWindow ||
        event.origin !== input.browserWindow.location.origin
      ) {
        return;
      }
      const parsed = BrowserExtensionEnrollmentResultMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.requestId !== input.requestId) return;
      if (parsed.data.state === "connecting") return;
      cleanup();
      if (parsed.data.state === "connected") {
        resolve("connected");
      } else {
        reject(new BrowserEnrollmentClientError(parsed.data.state));
      }
    };
    const timer = input.browserWindow.setTimeout(() => {
      cleanup();
      reject(new BrowserEnrollmentClientError("unavailable"));
    }, input.timeoutMilliseconds);
    input.browserWindow.addEventListener("message", listener);
  });
}

export async function connectBrowser(
  extensionInput: BrowserExtensionReadinessMessage,
  dependencies: ConnectBrowserDependencies = {}
): Promise<"connected"> {
  const extension = BrowserExtensionReadinessMessageV2Schema.safeParse(extensionInput);
  if (!extension.success) throw new BrowserEnrollmentClientError("version_incompatible");
  const browserWindow = dependencies.windowImplementation ?? window;
  const randomUUID = dependencies.randomUUID ?? crypto.randomUUID;
  const digest = dependencies.digest ?? sha256Hex;
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const timeoutMilliseconds = dependencies.timeoutMilliseconds ?? 15_000;
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 15_000
  ) {
    throw new BrowserEnrollmentClientError("unavailable");
  }

  const requestId = randomUUID();
  let responsePayload: unknown = null;
  let ticket = "";
  let bridgeRequest: Record<string, string> | null = null;
  try {
    const idempotencyKey = await digest(
      `browser-enrollment:v1:${requestId}:${extension.data.installationDigest}`
    );
    const response = await fetchImplementation(
      "/api/settings/integrations/browser-agent/enrollment",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          confirmation: "connect_read_only_browser",
          extensionVersion: extension.data.extensionVersion,
          protocolVersion: extension.data.enrollmentProtocolVersion,
          installationDigest: extension.data.installationDigest,
          idempotencyKey
        })
      }
    );
    responsePayload = await response.json();
    if (!response.ok) throw new BrowserEnrollmentClientError(publicFailureCode(responsePayload));
    const issued = CreateBrowserConnectorEnrollmentResponseSchema.parse(responsePayload);
    responsePayload = null;
    ticket = issued.ticket;
    const result = waitForEnrollmentResult({
      requestId,
      browserWindow,
      timeoutMilliseconds
    });
    bridgeRequest = {
      source: "vera-web",
      type: "connect-browser",
      version: "1",
      requestId,
      confirmation: "connect_read_only_browser",
      ticket,
      expiresAt: issued.expiresAt,
      gatewayOrigin: issued.gatewayOrigin,
      protocolVersion: issued.protocolVersion
    };
    browserWindow.postMessage(bridgeRequest, browserWindow.location.origin);
    bridgeRequest = null;
    return await result;
  } catch (error: unknown) {
    if (error instanceof BrowserEnrollmentClientError) throw error;
    throw new BrowserEnrollmentClientError("unavailable");
  } finally {
    ticket = "";
    responsePayload = null;
    bridgeRequest = null;
  }
}

export function clearBrowserConnection(
  browserWindow: Pick<BrowserEnrollmentWindow, "location" | "postMessage"> = window
): void {
  browserWindow.postMessage(
    {
      source: "vera-web",
      type: "clear-browser-connection",
      version: "1",
      requestId: crypto.randomUUID()
    },
    browserWindow.location.origin
  );
}
