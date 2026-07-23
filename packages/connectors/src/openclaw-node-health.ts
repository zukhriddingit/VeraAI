import { BrowserNodeStatusSchema, EntityIdSchema, type BrowserNodeStatus } from "@vera/domain";
import { z } from "zod";

import {
  OPENCLAW_PROVIDER_ID,
  OPENCLAW_TESTED_VERSION,
  type OpenClawAdapterConfig
} from "./openclaw-browser-execution.ts";
import { NodeOpenClawProcessRunner, type OpenClawProcessRunner } from "./openclaw-cli.ts";

const NodeSummarySchema = z
  .object({
    nodeId: EntityIdSchema,
    displayName: z.string().trim().min(1).max(120).optional(),
    connected: z.boolean().default(false),
    paired: z.boolean().default(false),
    approvalState: z
      .enum(["approved", "unapproved", "pending-approval", "pending-reapproval"])
      .optional()
  })
  .passthrough();
const NodeStatusResponseSchema = z
  .object({ nodes: z.array(NodeSummarySchema).max(100) })
  .passthrough();
const NodeDescriptionSchema = z
  .object({
    nodeId: EntityIdSchema,
    displayName: z.string().trim().min(1).max(120).optional(),
    version: z.string().trim().min(1).max(80).optional(),
    coreVersion: z.string().trim().min(1).max(80).optional(),
    commands: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    connected: z.boolean().default(false),
    paired: z.boolean().default(false),
    approvalState: z
      .enum(["approved", "unapproved", "pending-approval", "pending-reapproval"])
      .optional()
  })
  .passthrough();

export class OpenClawNodeHealthProvider {
  readonly #runner: OpenClawProcessRunner;
  readonly #now: () => Date;

  constructor(
    private readonly options: {
      readonly config: OpenClawAdapterConfig;
      readonly runner?: OpenClawProcessRunner;
      readonly now?: () => Date;
    }
  ) {
    this.#runner = options.runner ?? new NodeOpenClawProcessRunner();
    this.#now = options.now ?? (() => new Date());
  }

  async inspect(nodeIdInput: string, profileId: string): Promise<BrowserNodeStatus> {
    const nodeId = EntityIdSchema.parse(nodeIdInput);
    const versionResult = await this.run(["--version"], false);
    const cliCompatible = versionResult.stdout.includes(OPENCLAW_TESTED_VERSION);
    const statusResult = await this.run(["nodes", "status", "--json"], true);
    const status = NodeStatusResponseSchema.parse(JSON.parse(statusResult.stdout.trim()));
    const summary = status.nodes.find((node) => node.nodeId === nodeId);
    const now = this.#now();
    if (Number.isNaN(now.getTime()))
      throw new Error("OpenClaw node health requires a valid clock.");
    const heartbeatExpiresAt = new Date(now.getTime() + 90_000).toISOString();
    if (!summary) {
      return BrowserNodeStatusSchema.parse({
        nodeId,
        providerId: OPENCLAW_PROVIDER_ID,
        nodeName: "Configured browser node",
        status: "offline",
        pairingState: "not_paired",
        capabilityApprovalState: "not_approved",
        selectedProfileId: null,
        allowedProfileIds: [],
        reportedOpenClawVersion: cliCompatible ? OPENCLAW_TESTED_VERSION : null,
        expectedOpenClawVersion: OPENCLAW_TESTED_VERSION,
        versionCompatibility: cliCompatible ? "compatible" : "incompatible",
        lastHeartbeatAt: now.toISOString(),
        heartbeatExpiresAt,
        lastSuccessfulCaptureAt: null,
        disabledAt: null,
        contractVersion: 2,
        capabilities: { navigation: false, capture: false, cancellation: false },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
    }
    const descriptionResult = await this.run(
      ["nodes", "describe", "--node", nodeId, "--json"],
      true
    );
    const description = NodeDescriptionSchema.parse(JSON.parse(descriptionResult.stdout.trim()));
    if (description.nodeId !== nodeId)
      throw new Error("OpenClaw returned a mismatched node description.");
    const capabilityApproved =
      description.approvalState === "approved" && description.commands.includes("browser.proxy");
    const allowedProfileIds = capabilityApproved ? [profileId] : [];
    const selectedProfileId = capabilityApproved ? profileId : null;
    const reportedVersion = description.version ?? description.coreVersion ?? null;
    const compatible = cliCompatible && reportedVersion === OPENCLAW_TESTED_VERSION;
    return BrowserNodeStatusSchema.parse({
      nodeId,
      providerId: OPENCLAW_PROVIDER_ID,
      nodeName: summary.displayName ?? description.displayName ?? "Configured browser node",
      status: summary.connected ? "online" : "offline",
      pairingState: summary.paired ? "paired" : "pairing_pending",
      capabilityApprovalState: capabilityApproved ? "approved" : "approval_pending",
      selectedProfileId,
      allowedProfileIds,
      reportedOpenClawVersion: reportedVersion,
      expectedOpenClawVersion: OPENCLAW_TESTED_VERSION,
      versionCompatibility: compatible ? "compatible" : "incompatible",
      lastHeartbeatAt: now.toISOString(),
      heartbeatExpiresAt,
      lastSuccessfulCaptureAt: null,
      disabledAt: null,
      contractVersion: 2,
      capabilities: {
        navigation: false,
        capture: capabilityApproved && selectedProfileId !== null,
        cancellation: capabilityApproved
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });
  }

  private run(args: readonly string[], withGateway: boolean) {
    const environment: Record<string, string> = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      NO_COLOR: "1"
    };
    if (withGateway) {
      environment.OPENCLAW_GATEWAY_URL = this.options.config.gatewayUrl;
      environment.OPENCLAW_GATEWAY_TOKEN = this.options.config.gatewayToken;
    }
    return this.#runner.run({
      executable: this.options.config.executable,
      args,
      environment,
      timeoutMilliseconds: this.options.config.timeoutMilliseconds,
      maxOutputBytes: this.options.config.maxOutputBytes
    });
  }
}
