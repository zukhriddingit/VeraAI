import { createHash } from "node:crypto";

import {
  BrowserNodeStatusSchema,
  type BrowserNodeStatus,
  type ManualActionBlocker,
  type SourceJobSafeError
} from "@vera/domain";
import { requireMatchingZillowCurrentTabUrl, ZillowCurrentTabUrlError } from "@vera/policy";
import { z } from "zod";

import {
  BrowserCancellationRequestSchema,
  BrowserCancellationResultSchema,
  BrowserCaptureRequestSchema,
  BrowserCurrentTabCaptureRequestSchema,
  BrowserCurrentTabCaptureResultSchema,
  BrowserExecutionResultSchema,
  BrowserHeartbeatRequestSchema,
  BrowserHeartbeatResultSchema,
  BrowserNavigationRequestSchema,
  type BrowserCancellationRequest,
  type BrowserCancellationResult,
  type BrowserCaptureRequest,
  type BrowserCurrentTabCaptureRequest,
  type BrowserCurrentTabCaptureResult,
  type BrowserExecutionProvider,
  type BrowserExecutionResult,
  type BrowserHeartbeatRequest,
  type BrowserHeartbeatResult,
  type BrowserNavigationRequest
} from "./browser-execution.ts";
import {
  NodeOpenClawProcessRunner,
  OpenClawProcessError,
  type OpenClawProcessInput,
  type OpenClawProcessResult,
  type OpenClawProcessRunner
} from "./openclaw-cli.ts";

export const OPENCLAW_TESTED_VERSION = "2026.6.33" as const;
export const OPENCLAW_PROVIDER_ID = "openclaw-2026.6.33" as const;

const OpenClawAdapterConfigSchema = z
  .object({
    executable: z.string().trim().min(1).max(1_024),
    gatewayUrl: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .regex(/^wss?:\/\/[^\s/?#]+(?::\d{1,5})?(?:\/[^\s?#]*)?$/u)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "wss:" ||
          (url.protocol === "ws:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase()))
        );
      }, "Plain ws:// is allowed only for loopback development."),
    gatewayToken: z.string().min(16).max(4_096),
    timeoutMilliseconds: z.number().int().positive().max(60_000),
    maxOutputBytes: z.number().int().positive().max(2_000_000)
  })
  .strict();

export type OpenClawAdapterConfig = z.infer<typeof OpenClawAdapterConfigSchema>;

const OpenClawTabSchema = z
  .object({
    targetId: z.string().trim().min(1).max(512),
    suggestedTargetId: z.string().trim().min(1).max(512).optional(),
    tabId: z.string().trim().min(1).max(512).optional(),
    url: z.string().trim().min(1).max(2_048),
    title: z.string().trim().max(500).optional()
  })
  .passthrough();

const OpenClawTabsResultSchema = z
  .object({ running: z.boolean(), tabs: z.array(OpenClawTabSchema).max(100) })
  .passthrough();

const OpenClawSnapshotResultSchema = z
  .object({
    ok: z.literal(true),
    format: z.literal("ai"),
    targetId: z.string().trim().min(1).max(512),
    url: z.string().trim().min(1).max(2_048),
    snapshot: z.string().max(250_000),
    blockedByDialog: z.boolean().optional()
  })
  .passthrough();

const OpenClawInvokeEnvelopeSchema = z
  .object({
    payloadJSON: z.string().max(2_000_000).optional(),
    payload: z.unknown().optional()
  })
  .passthrough();

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableChildKey(base: string, phase: "tabs" | "snapshot"): string {
  return sha256(`vera-openclaw-current-tab:v1:${base}:${phase}`);
}

function safeFailure(code: string, category: SourceJobSafeError["category"]): SourceJobSafeError {
  return { code, category };
}

function unwrapInvokeResult(result: OpenClawProcessResult): unknown {
  if (result.exitCode !== 0) throw new Error("openclaw_cli_nonzero_exit");
  const envelope = OpenClawInvokeEnvelopeSchema.parse(JSON.parse(result.stdout.trim()));
  const payload =
    envelope.payloadJSON !== undefined ? JSON.parse(envelope.payloadJSON) : envelope.payload;
  if (typeof payload !== "object" || payload === null || !("result" in payload)) {
    throw new Error("openclaw_proxy_result_missing");
  }
  return (payload as { readonly result: unknown }).result;
}

function manualBlockerFromUrl(url: string): ManualActionBlocker | null {
  const normalized = url.toLowerCase();
  if (/\/(?:login|signin|auth)(?:\/|\?|$)/u.test(normalized)) return "login_required";
  if (/captcha|challenge|verify/u.test(normalized)) return "captcha_required";
  return null;
}

function manualBlockerFromSnapshot(
  snapshot: string,
  blockedByDialog: boolean
): ManualActionBlocker | null {
  if (blockedByDialog) return "consent_required";
  const normalized = snapshot.toLowerCase();
  if (/captcha|hcaptcha|recaptcha|verify you(?:'re| are) human/u.test(normalized)) {
    return "captcha_required";
  }
  if (/two[- ]factor|verification code|authenticator code/u.test(normalized)) {
    return "two_factor_required";
  }
  if (/too many requests|rate limit|bot challenge|unusual traffic/u.test(normalized)) {
    return "rate_or_bot_challenge";
  }
  if (/allow (?:camera|microphone)|camera permission|microphone permission/u.test(normalized)) {
    return "camera_or_microphone_requested";
  }
  if (/upload (?:a )?file|choose file|download (?:this|the) file/u.test(normalized)) {
    return "download_or_upload_requested";
  }
  if (/sign in to zillow|log in to zillow/u.test(normalized)) return "login_required";
  return null;
}

function manualResult(
  request: BrowserCurrentTabCaptureRequest,
  blocker: ManualActionBlocker,
  completedAt: string,
  instruction: string
): BrowserCurrentTabCaptureResult {
  return BrowserCurrentTabCaptureResultSchema.parse({
    providerId: OPENCLAW_PROVIDER_ID,
    nodeId: request.nodeId,
    profileId: request.profileId,
    executionId: request.executionId,
    status: "manual_action_required",
    correlationId: request.correlationId,
    evidence: null,
    manualAction: {
      nodeId: request.nodeId,
      executionId: request.executionId,
      blocker,
      instruction,
      correlationId: request.correlationId,
      requiredAt: completedAt
    },
    deferredReason: null,
    error: null,
    completedAt,
    untrustedInput: true
  });
}

function failedResult(
  request: BrowserCurrentTabCaptureRequest,
  status: "retryable_failed" | "permanently_failed",
  error: SourceJobSafeError,
  completedAt: string
): BrowserCurrentTabCaptureResult {
  return BrowserCurrentTabCaptureResultSchema.parse({
    providerId: OPENCLAW_PROVIDER_ID,
    nodeId: request.nodeId,
    profileId: request.profileId,
    executionId: request.executionId,
    status,
    correlationId: request.correlationId,
    evidence: null,
    manualAction: null,
    deferredReason: null,
    error,
    completedAt,
    untrustedInput: true
  });
}

export interface OpenClawBrowserExecutionProviderOptions {
  readonly config: OpenClawAdapterConfig;
  readonly processRunner?: OpenClawProcessRunner;
  readonly now?: () => Date;
}

export class OpenClawBrowserExecutionProvider implements BrowserExecutionProvider {
  readonly providerId = OPENCLAW_PROVIDER_ID;
  readonly #config: OpenClawAdapterConfig;
  readonly #processRunner: OpenClawProcessRunner;
  readonly #now: () => Date;
  readonly #active = new Map<string, AbortController>();
  #versionVerified = false;

  constructor(options: OpenClawBrowserExecutionProviderOptions) {
    this.#config = OpenClawAdapterConfigSchema.parse(options.config);
    this.#processRunner = options.processRunner ?? new NodeOpenClawProcessRunner();
    this.#now = options.now ?? (() => new Date());
  }

  async heartbeat(input: BrowserHeartbeatRequest): Promise<BrowserHeartbeatResult> {
    const request = BrowserHeartbeatRequestSchema.parse(input);
    const now = this.safeNowIso();
    const node: BrowserNodeStatus = BrowserNodeStatusSchema.parse({
      nodeId: request.nodeId,
      providerId: this.providerId,
      nodeName: "OpenClaw browser node",
      status: "offline",
      pairingState: "not_paired",
      capabilityApprovalState: "not_approved",
      selectedProfileId: null,
      allowedProfileIds: [],
      reportedOpenClawVersion: null,
      expectedOpenClawVersion: OPENCLAW_TESTED_VERSION,
      versionCompatibility: "unknown",
      lastHeartbeatAt: now,
      heartbeatExpiresAt: now,
      contractVersion: 2,
      capabilities: { navigation: false, capture: true, cancellation: true },
      createdAt: now,
      updatedAt: now
    });
    return BrowserHeartbeatResultSchema.parse({
      correlationId: request.correlationId,
      node,
      untrustedInput: true
    });
  }

  async navigate(input: BrowserNavigationRequest): Promise<BrowserExecutionResult> {
    return this.unsupportedLegacy(BrowserNavigationRequestSchema.parse(input), "navigate");
  }

  async capture(input: BrowserCaptureRequest): Promise<BrowserExecutionResult> {
    return this.unsupportedLegacy(BrowserCaptureRequestSchema.parse(input), "capture");
  }

  async captureCurrentTab(
    input: BrowserCurrentTabCaptureRequest
  ): Promise<BrowserCurrentTabCaptureResult> {
    const request = BrowserCurrentTabCaptureRequestSchema.parse(input);
    const controller = new AbortController();
    this.#active.set(request.executionId, controller);
    try {
      await this.verifyVersion(controller.signal);
      const tabs = OpenClawTabsResultSchema.parse(
        unwrapInvokeResult(
          await this.invokeProxy(
            request,
            "tabs",
            { method: "GET", path: "/tabs", profile: request.profileId, timeoutMs: 10_000 },
            controller.signal
          )
        )
      );
      if (!tabs.running || tabs.tabs.length === 0) {
        return manualResult(
          request,
          "browser_profile_unavailable",
          this.safeNowIso(),
          "Start the dedicated Vera browser profile and open the approved Zillow listing."
        );
      }

      const matchingTabs = tabs.tabs.filter((tab) => {
        try {
          return (
            requireMatchingZillowCurrentTabUrl(request.expectedUrl, tab.url) ===
            request.canonicalUrl
          );
        } catch {
          return false;
        }
      });
      if (matchingTabs.length === 0) {
        const onlyTab = tabs.tabs.length === 1 ? tabs.tabs[0] : undefined;
        const onlyTabBlocker = onlyTab ? manualBlockerFromUrl(onlyTab.url) : null;
        return manualResult(
          request,
          onlyTabBlocker ?? "active_url_mismatch",
          this.safeNowIso(),
          onlyTabBlocker
            ? "Complete the browser prompt manually, return to the listing, and retry."
            : "Open and focus the exact approved Zillow listing URL, then retry."
        );
      }
      if (matchingTabs.length !== 1) {
        return manualResult(
          request,
          "user_intervention_required",
          this.safeNowIso(),
          "Close duplicate copies of the approved listing, keep one tab open, and retry."
        );
      }
      const currentTab = matchingTabs[0]!;

      let canonicalUrl: string;
      try {
        canonicalUrl = requireMatchingZillowCurrentTabUrl(request.expectedUrl, currentTab.url);
      } catch (error: unknown) {
        const blocker =
          error instanceof ZillowCurrentTabUrlError && error.code === "active_url_mismatch"
            ? "active_url_mismatch"
            : "unexpected_redirect";
        return manualResult(
          request,
          blocker,
          this.safeNowIso(),
          "Open and focus the exact approved Zillow listing URL, then retry."
        );
      }
      if (canonicalUrl !== request.canonicalUrl) {
        return manualResult(
          request,
          "active_url_mismatch",
          this.safeNowIso(),
          "The active tab no longer matches the approved canonical listing URL."
        );
      }

      const snapshot = OpenClawSnapshotResultSchema.parse(
        unwrapInvokeResult(
          await this.invokeProxy(
            request,
            "snapshot",
            {
              method: "GET",
              path: "/snapshot",
              profile: request.profileId,
              query: {
                profile: request.profileId,
                targetId: currentTab.suggestedTargetId ?? currentTab.tabId ?? currentTab.targetId,
                format: "ai",
                compact: "true",
                urls: "false",
                limit: "800",
                maxChars: String(Math.min(request.limits.maxBytes, 250_000))
              },
              timeoutMs: Math.min(request.limits.maxDurationMilliseconds, 30_000)
            },
            controller.signal
          )
        )
      );
      if (snapshot.targetId !== currentTab.targetId) {
        return manualResult(
          request,
          "stale_snapshot",
          this.safeNowIso(),
          "Focus the intended listing tab and retry with a fresh snapshot."
        );
      }
      try {
        requireMatchingZillowCurrentTabUrl(request.expectedUrl, snapshot.url);
      } catch {
        return manualResult(
          request,
          "unexpected_redirect",
          this.safeNowIso(),
          "The page changed origin or listing identity during capture. Return to the approved listing and retry."
        );
      }
      const blocker = manualBlockerFromSnapshot(
        snapshot.snapshot,
        snapshot.blockedByDialog === true
      );
      if (blocker !== null) {
        return manualResult(
          request,
          blocker,
          this.safeNowIso(),
          "Resolve the browser blocker manually and retry the current-tab capture."
        );
      }
      if (snapshot.snapshot.trim().length === 0) {
        return manualResult(
          request,
          "layout_incompatible",
          this.safeNowIso(),
          "The listing layout could not be captured safely. Do not retry automatically."
        );
      }

      const observedAt = this.safeNowIso();
      const pageTitle = currentTab.title?.trim() || "Zillow listing";
      const contentHash = sha256(
        JSON.stringify({ canonicalUrl, pageTitle, renderedText: snapshot.snapshot })
      );
      return BrowserCurrentTabCaptureResultSchema.parse({
        providerId: this.providerId,
        nodeId: request.nodeId,
        profileId: request.profileId,
        executionId: request.executionId,
        status: "completed",
        correlationId: request.correlationId,
        evidence: {
          captureId: `capture-${contentHash.slice(0, 32)}`,
          activeUrl: currentTab.url,
          canonicalUrl,
          pageTitle,
          renderedText: snapshot.snapshot,
          structuredMetadata: {},
          imageUrls: [],
          observedAt,
          nodeId: request.nodeId,
          profileId: request.profileId,
          contentHash
        },
        manualAction: null,
        deferredReason: null,
        error: null,
        completedAt: observedAt,
        untrustedInput: true
      });
    } catch (error: unknown) {
      return this.safeFailureResult(request, error);
    } finally {
      this.#active.delete(request.executionId);
    }
  }

  async cancel(input: BrowserCancellationRequest): Promise<BrowserCancellationResult> {
    const request = BrowserCancellationRequestSchema.parse(input);
    const active = this.#active.get(request.executionId);
    active?.abort();
    return BrowserCancellationResultSchema.parse({
      providerId: this.providerId,
      nodeId: request.nodeId,
      executionId: request.executionId,
      correlationId: request.correlationId,
      status: "cancelled",
      reason: request.reason,
      requestedAt: request.requestedAt,
      cancelledAt: this.safeNowIso(),
      alreadyCancelled: active === undefined,
      untrustedInput: true
    });
  }

  private async verifyVersion(signal: AbortSignal): Promise<void> {
    if (this.#versionVerified) return;
    const result = await this.#processRunner.run({
      executable: this.#config.executable,
      args: ["--version"],
      environment: this.baseEnvironment(),
      timeoutMilliseconds: 5_000,
      maxOutputBytes: 4_096,
      signal
    });
    if (result.exitCode !== 0 || !result.stdout.trim().includes(OPENCLAW_TESTED_VERSION)) {
      throw new Error("openclaw_version_incompatible");
    }
    this.#versionVerified = true;
  }

  private invokeProxy(
    request: BrowserCurrentTabCaptureRequest,
    phase: "tabs" | "snapshot",
    params: Readonly<Record<string, unknown>>,
    signal: AbortSignal
  ): Promise<OpenClawProcessResult> {
    const processInput: OpenClawProcessInput = {
      executable: this.#config.executable,
      args: [
        "nodes",
        "invoke",
        "--node",
        request.nodeId,
        "--command",
        "browser.proxy",
        "--params",
        JSON.stringify(params),
        "--invoke-timeout",
        String(Math.min(this.#config.timeoutMilliseconds, 30_000)),
        "--idempotency-key",
        stableChildKey(request.invocationIdempotencyKey, phase),
        "--json"
      ],
      environment: this.environment(),
      timeoutMilliseconds: this.#config.timeoutMilliseconds,
      maxOutputBytes: this.#config.maxOutputBytes,
      signal
    };
    return this.#processRunner.run(processInput);
  }

  private environment(): Readonly<Record<string, string>> {
    return {
      ...this.baseEnvironment(),
      OPENCLAW_GATEWAY_URL: this.#config.gatewayUrl,
      OPENCLAW_GATEWAY_TOKEN: this.#config.gatewayToken
    };
  }

  private baseEnvironment(): Readonly<Record<string, string>> {
    return {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      OPENCLAW_HIDE_BANNER: "1",
      OPENCLAW_SUPPRESS_NOTES: "1",
      NO_COLOR: "1"
    };
  }

  private unsupportedLegacy(
    request: BrowserNavigationRequest | BrowserCaptureRequest,
    operation: "navigate" | "capture"
  ): BrowserExecutionResult {
    return BrowserExecutionResultSchema.parse({
      providerId: this.providerId,
      nodeId: request.nodeId,
      executionId: request.executionId,
      operation,
      status: "permanently_failed",
      correlationId: request.correlationId,
      evidence: [],
      recordCount: 0,
      previousCursor: "committedCursor" in request ? request.committedCursor : null,
      cursorCandidate: null,
      manualAction: null,
      deferredReason: null,
      error: safeFailure("openclaw_operation_unsupported", "policy_denial"),
      completedAt: this.safeNowIso(),
      untrustedInput: true
    });
  }

  private safeFailureResult(
    request: BrowserCurrentTabCaptureRequest,
    error: unknown
  ): BrowserCurrentTabCaptureResult {
    const at = this.safeNowIso();
    if (error instanceof OpenClawProcessError) {
      if (error.code === "cancelled") {
        return BrowserCurrentTabCaptureResultSchema.parse({
          providerId: this.providerId,
          nodeId: request.nodeId,
          profileId: request.profileId,
          executionId: request.executionId,
          status: "cancelled",
          correlationId: request.correlationId,
          evidence: null,
          manualAction: null,
          deferredReason: null,
          error: null,
          completedAt: at,
          untrustedInput: true
        });
      }
      return failedResult(
        request,
        error.code === "output_limit" ? "permanently_failed" : "retryable_failed",
        safeFailure(
          `openclaw_${error.code}`,
          error.code === "output_limit" ? "validation" : "transient_provider"
        ),
        at
      );
    }
    if (error instanceof Error && error.message === "openclaw_version_incompatible") {
      return manualResult(
        request,
        "version_incompatible",
        at,
        `Install the tested OpenClaw ${OPENCLAW_TESTED_VERSION} release before retrying.`
      );
    }
    return failedResult(
      request,
      "permanently_failed",
      safeFailure("openclaw_response_rejected", "validation"),
      at
    );
  }

  private safeNowIso(): string {
    const value = this.#now();
    if (Number.isNaN(value.getTime())) throw new RangeError("OpenClaw provider clock is invalid.");
    return value.toISOString();
  }
}
