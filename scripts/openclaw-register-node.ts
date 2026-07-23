import {
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig,
  sha256Text
} from "@vera/db";
import { BrowserProfileIdSchema, EntityIdSchema, VeraUserIdSchema } from "@vera/domain";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

if (required("VERA_OPENCLAW_PAIRING_VERIFIED") !== "I_VERIFIED_DEVICE_AND_NODE_PAIRING") {
  throw new Error("Pairing acknowledgement is invalid.");
}
if (required("VERA_OPENCLAW_CAPABILITY_VERIFIED") !== "I_VERIFIED_BROWSER_PROXY_ONLY") {
  throw new Error("Capability acknowledgement is invalid.");
}

const userId = VeraUserIdSchema.parse(required("VERA_BROWSER_USER_ID"));
const nodeId = EntityIdSchema.parse(required("VERA_OPENCLAW_NODE_ID"));
const profileId = BrowserProfileIdSchema.parse(required("VERA_OPENCLAW_PROFILE_ID"));
const nodeName = required("VERA_OPENCLAW_NODE_NAME");
const now = new Date();
const at = now.toISOString();
const connection = openPostgresConnection(parsePostgresConfig(process.env));

try {
  const repositories = createPostgresRepositoryProvider(connection).forUser(userId);
  await repositories.browserNodes.upsert({
    nodeId,
    providerId: "openclaw-2026.6.33",
    nodeName,
    status: "online",
    pairingState: "paired",
    capabilityApprovalState: "approved",
    selectedProfileId: profileId,
    allowedProfileIds: [profileId],
    reportedOpenClawVersion: "2026.6.33",
    expectedOpenClawVersion: "2026.6.33",
    versionCompatibility: "compatible",
    lastHeartbeatAt: at,
    heartbeatExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    lastSuccessfulCaptureAt: null,
    disabledAt: null,
    contractVersion: 2,
    capabilities: { navigation: false, capture: true, cancellation: true },
    createdAt: at,
    updatedAt: at
  });
  await repositories.browserProfileControls.upsert({
    nodeId,
    profileId,
    disabledAt: null,
    updatedAt: at
  });
  const healthScheduleId = `browser-health-${sha256Text(`${userId}:openclaw-health:v1`).slice(0, 24)}`;
  const existingHealthSchedule = await repositories.productionSchedules.getById(healthScheduleId);
  await repositories.productionSchedules.upsert({
    id: healthScheduleId,
    userId,
    kind: "health_reconciliation",
    state: "enabled",
    intervalSeconds: 60,
    sourceConfigurationId: null,
    nextRunAt: new Date(now.getTime() + 60_000).toISOString(),
    lastRunAt: existingHealthSchedule?.lastRunAt ?? null,
    createdAt: existingHealthSchedule?.createdAt ?? at,
    updatedAt: at
  });
  await repositories.activityEvents.append({
    id: `activity-browser-register-${sha256Text(`${userId}:${nodeId}:${profileId}:${at}`).slice(0, 24)}`,
    correlationId: `browser-register-${sha256Text(`${userId}:${nodeId}:${at}`).slice(0, 24)}`,
    causationId: null,
    actor: "user",
    action: "browser.node_registered",
    targetType: "browser_node",
    targetId: nodeId,
    policyDecision: "not_applicable",
    approvalId: null,
    payloadHash: sha256Text(`browser-node-registration:v1:${userId}:${nodeId}:${profileId}`),
    outcome: "recorded",
    errorCategory: null,
    metadata: {
      providerId: "openclaw-2026.6.33",
      version: "2026.6.33",
      profileConfigured: true,
      browserProxyOnlyAcknowledged: true
    },
    occurredAt: at
  });
  process.stdout.write(
    "Registered the verified OpenClaw node/profile for this Vera owner. Source controls remain disabled.\n"
  );
} finally {
  await connection.close();
}
