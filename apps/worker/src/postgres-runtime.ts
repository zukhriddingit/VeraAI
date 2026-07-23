import { randomUUID } from "node:crypto";

import {
  createPostgresRepositoryProvider,
  createPostgresEphemeralCleanupRepository,
  createPostgresMaritimeOperationsRepository,
  createPostgresWorkerQueue,
  checkPostgresReadiness,
  decryptCredential,
  openPostgresConnection,
  parsePostgresConfig,
  StaticCredentialKeyProvider
} from "@vera/db";
import {
  GmailAlertConnector,
  GmailClientError,
  GoogleGmailClient,
  createMaritimeControlPlaneClient,
  OpenClawBrowserExecutionProvider,
  OpenClawNodeHealthProvider
} from "@vera/connectors";
import { PushSubscriptionDataSchema, createWebPushNotificationProvider } from "@vera/notifications";
import { GOOGLE_GMAIL_ALERT_MANIFEST, SourcePolicyRegistry } from "@vera/policy";

import { createRotatingWorkerRuntime } from "./decision-runtime.js";
import {
  ACQUISITION_LEASE_DURATION_MILLISECONDS,
  processNextAcquisitionJob
} from "./acquisition-worker.js";
import { DECISION_LEASE_DURATION_MILLISECONDS, processNextDecisionJob } from "./decision-worker.js";
import {
  NORMALIZATION_LEASE_DURATION_MILLISECONDS,
  processNextNormalizationJob
} from "./normalization-worker.js";
import { createWorkerProviderRuntime } from "./provider-factory.js";
import { reconcileNextProductionSchedule } from "./maritime-scheduler.js";
import { processNextNotification } from "./notification-worker.js";
import { runGmailAlertIngestion } from "./gmail-alert-worker.js";
import { refreshGmailAccessToken } from "./google-gmail-access.js";
import { reconcileHostedHealth } from "./health-reconciliation.js";
import { fanOutEligibleNotifications } from "./notification-fanout.js";
import { parseWorkerRuntimeConfig, type WorkerRuntimeConfig } from "./runtime-config.js";

function credentialKeys(environment: Readonly<Record<string, string | undefined>>) {
  const keyId = environment.VERA_CREDENTIAL_KEY_ID?.trim();
  const encoded = environment.VERA_CREDENTIAL_KEYS_JSON?.trim();
  if (!keyId || !encoded) return null;
  const parsed = JSON.parse(encoded) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("VERA_CREDENTIAL_KEYS_JSON must be a JSON object.");
  }
  const keys = new Map<string, Uint8Array>();
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value !== "string") throw new Error("Credential keys must be base64 strings.");
    keys.set(id, Buffer.from(value, "base64"));
  }
  return new StaticCredentialKeyProvider(keyId, keys);
}

export function createPostgresWorkerRuntime(
  leaseOwner: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  command: WorkerRuntimeConfig["command"] = "start"
) {
  const config = parseWorkerRuntimeConfig(environment, command);
  const postgresConfig = parsePostgresConfig(environment);
  const providerRuntime = createWorkerProviderRuntime({ environment });
  const now = () => new Date();
  const gatewayUrl = config.openClawGatewayUrl;
  const gatewayToken = config.openClawGatewayToken;
  const browserProvider =
    gatewayUrl && gatewayToken
      ? new OpenClawBrowserExecutionProvider({
          config: {
            executable: config.openClawExecutable,
            gatewayUrl,
            gatewayToken,
            timeoutMilliseconds: 30_000,
            maxOutputBytes: 1_000_000
          }
        })
      : null;
  const browserHealthProvider =
    gatewayUrl && gatewayToken
      ? new OpenClawNodeHealthProvider({
          config: {
            executable: config.openClawExecutable,
            gatewayUrl,
            gatewayToken,
            timeoutMilliseconds: 30_000,
            maxOutputBytes: 1_000_000
          },
          now
        })
      : null;
  const systemBrowserDisabled = config.browserDisabled;
  const maritimeWorkerAgentId = config.maritimeWorkerAgentId;
  const maritimeGatewayAgentId = config.maritimeGatewayAgentId;
  const maritimeClient =
    maritimeWorkerAgentId && maritimeGatewayAgentId && config.maritimeApiKey
      ? createMaritimeControlPlaneClient(environment as NodeJS.ProcessEnv)
      : null;
  const maritimeEnvironment = config.maritimeEnvironment;
  let nextHealthReconciliationAt = 0;
  // Missing configuration is fail-closed. Production must explicitly set this to
  // 0/false and provide complete VAPID plus encryption-key material.
  const notificationsDisabled = config.notificationsDisabled;
  const keyProvider = credentialKeys(environment);
  const vapid = {
    subject: environment.VERA_VAPID_SUBJECT?.trim() ?? "",
    publicKey: environment.NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY?.trim() ?? "",
    privateKey: environment.VERA_VAPID_PRIVATE_KEY?.trim() ?? ""
  };
  const notificationProvider = notificationsDisabled
    ? null
    : createWebPushNotificationProvider(vapid);
  if (notificationProvider && !keyProvider) {
    throw new Error("Credential encryption keys are required when Web Push is enabled.");
  }
  const gmailDisabled = config.gmailAlertsDisabled;
  const gmailPolicy = new SourcePolicyRegistry([GOOGLE_GMAIL_ALERT_MANIFEST], {
    activeKillSwitches: new Set([
      ...(gmailDisabled ? [GOOGLE_GMAIL_ALERT_MANIFEST.connectorKillSwitchKey] : []),
      ...(config.integrationsDisabled ? [GOOGLE_GMAIL_ALERT_MANIFEST.globalKillSwitchKey] : [])
    ])
  });
  // Every environment- and secret-derived provider is validated before the pool is
  // opened so a rejected hosted configuration cannot leak a connection resource.
  const connection = openPostgresConnection(postgresConfig);
  const repositoryProvider = createPostgresRepositoryProvider(connection);
  const queue = createPostgresWorkerQueue(connection);
  const operations = createPostgresMaritimeOperationsRepository(connection.db);
  const ephemeralCleanup = createPostgresEphemeralCleanupRepository(connection);

  const runtime = createRotatingWorkerRuntime({
    async processSchedule(signal) {
      return reconcileNextProductionSchedule(
        {
          queue,
          repositoriesForUser: (userId) => repositoryProvider.forUser(userId),
          async handler(userId, schedule) {
            if (signal.aborted) throw signal.reason;
            if (schedule.state !== "enabled") return { status: "cancelled_by_policy" };
            if (schedule.kind === "notification_fanout") {
              const result = await fanOutEligibleNotifications({
                userId,
                repositories: repositoryProvider.forUser(userId),
                killSwitchActive: notificationsDisabled,
                now,
                createId: randomUUID
              });
              return { status: result.status };
            }
            if (schedule.kind === "health_reconciliation") {
              if (!browserHealthProvider) {
                return {
                  status: "permanently_failed",
                  safeErrorCode: "openclaw_gateway_configuration_missing"
                };
              }
              const repositories = repositoryProvider.forUser(userId);
              const nodes = await repositories.browserNodes.list();
              try {
                for (const node of nodes) {
                  if (node.selectedProfileId === null || node.disabledAt !== null) continue;
                  const inspected = await browserHealthProvider.inspect(
                    node.nodeId,
                    node.selectedProfileId
                  );
                  await repositories.browserNodes.upsert({
                    ...inspected,
                    createdAt: node.createdAt,
                    lastSuccessfulCaptureAt: node.lastSuccessfulCaptureAt,
                    disabledAt: node.disabledAt
                  });
                }
                return { status: "completed" };
              } catch {
                return {
                  status: "retryable_failed",
                  safeErrorCode: "openclaw_gateway_unavailable"
                };
              }
            }
            if (schedule.kind === "ephemeral_cleanup") {
              try {
                await ephemeralCleanup.cleanup({ now: now().toISOString(), batchSize: 500 });
                return { status: "completed" };
              } catch {
                return {
                  status: "retryable_failed",
                  safeErrorCode: "ephemeral_cleanup_failed"
                };
              }
            }
            if (schedule.kind !== "gmail_alert_ingestion") {
              // These schedules wake durable queue lanes; they never execute provider work here.
              return { status: "completed" };
            }
            const policy = gmailPolicy.evaluate({
              connectorId: GOOGLE_GMAIL_ALERT_MANIFEST.connectorId,
              acquisitionMode: "email_alert",
              capability: "gmail.alert.read",
              execution: "scheduled",
              operation: "gmail.alert.read_configured",
              hasUserSession: true,
              hasApproval: false,
              network: {
                origin: "https://gmail.googleapis.com/",
                domain: "gmail.googleapis.com",
                httpMethod: "GET"
              }
            });
            if (!policy.allowed) return { status: "cancelled_by_policy" };
            if (
              !keyProvider ||
              !environment.VERA_GOOGLE_INTEGRATION_CLIENT_ID?.trim() ||
              !environment.VERA_GOOGLE_INTEGRATION_CLIENT_SECRET?.trim()
            ) {
              return { status: "permanently_failed", safeErrorCode: "gmail_configuration_missing" };
            }
            if (schedule.sourceConfigurationId === null) {
              return {
                status: "permanently_failed",
                safeErrorCode: "gmail_source_configuration_missing"
              };
            }
            const repositories = repositoryProvider.forUser(userId);
            try {
              const accessToken = await refreshGmailAccessToken({
                userId,
                repositories,
                keyProvider,
                clientId: environment.VERA_GOOGLE_INTEGRATION_CLIENT_ID.trim(),
                clientSecret: environment.VERA_GOOGLE_INTEGRATION_CLIENT_SECRET.trim(),
                signal,
                now
              });
              const result = await runGmailAlertIngestion(
                {
                  userId,
                  sourceConfigurationId: schedule.sourceConfigurationId,
                  repositoryProvider,
                  connector: new GmailAlertConnector(new GoogleGmailClient(accessToken), {
                    label: "Vera",
                    allowedSenders: [
                      "alerts@zillow.com",
                      "noreply@apartments.com",
                      "alerts@realtor.com",
                      "alerts@zumper.com"
                    ],
                    subjectTerms: ["new listing", "new rental", "rental alert"],
                    maxResults: 50
                  }),
                  correlationId: randomUUID(),
                  now,
                  createId: randomUUID
                },
                signal
              );
              return result.status === "completed"
                ? { status: "completed" }
                : { status: result.status, safeErrorCode: result.safeErrorCode };
            } catch (error: unknown) {
              if (error instanceof GmailClientError) {
                return {
                  status: error.retryable ? "retryable_failed" : "permanently_failed",
                  safeErrorCode: error.code
                };
              }
              return { status: "retryable_failed", safeErrorCode: "gmail_provider_unavailable" };
            }
          },
          now,
          createId: randomUUID
        },
        signal
      );
    },
    async processAcquisition(signal) {
      const claimedAt = now();
      const claim = {
        leaseOwner,
        now: claimedAt.toISOString(),
        leaseExpiresAt: new Date(
          claimedAt.getTime() + ACQUISITION_LEASE_DURATION_MILLISECONDS
        ).toISOString()
      };
      const owned = maritimeWorkerAgentId
        ? await queue.claimNextDispatchedSourceJob({ ...claim, audience: maritimeWorkerAgentId })
        : await queue.claimNextSourceJob(claim);
      if (!owned) return { status: "idle" };
      return processNextAcquisitionJob(
        {
          userId: owned.userId,
          repositoryProvider,
          repositories: repositoryProvider.forUser(owned.userId),
          claimedJob: owned.job,
          provider: browserProvider,
          founderBrowserUserIds: environment.VERA_BROWSER_FOUNDER_USER_IDS,
          systemBrowserDisabled,
          now,
          createId: randomUUID
        },
        signal
      );
    },
    async processNormalization(signal) {
      const claimedAt = now();
      const owned = await queue.claimNextNormalizationJob({
        leaseOwner,
        now: claimedAt.toISOString(),
        leaseExpiresAt: new Date(
          claimedAt.getTime() + NORMALIZATION_LEASE_DURATION_MILLISECONDS
        ).toISOString()
      });
      if (!owned) return { status: "idle" };
      return processNextNormalizationJob(
        {
          userId: owned.userId,
          repositoryProvider,
          repositories: repositoryProvider.forUser(owned.userId),
          claimedJob: owned.job,
          leaseOwner,
          provider: providerRuntime.provider,
          providerTimeoutMilliseconds: providerRuntime.timeoutMilliseconds,
          now,
          createId: randomUUID
        },
        signal
      );
    },
    async processDecision(signal) {
      const claimedAt = now();
      const owned = await queue.claimNextDecisionJob({
        leaseOwner,
        now: claimedAt.toISOString(),
        leaseExpiresAt: new Date(
          claimedAt.getTime() + DECISION_LEASE_DURATION_MILLISECONDS
        ).toISOString()
      });
      if (!owned) return { status: "idle" };
      return processNextDecisionJob(
        {
          userId: owned.userId,
          repositoryProvider,
          repositories: repositoryProvider.forUser(owned.userId),
          claimedJob: owned.job,
          leaseOwner,
          now,
          createId: randomUUID
        },
        signal
      );
    },
    async processNotification(signal) {
      if (!notificationProvider || !keyProvider) return { status: "idle" };
      return processNextNotification(
        {
          queue,
          repositoriesForUser: (userId) => repositoryProvider.forUser(userId),
          provider: notificationProvider,
          async resolveSubscription(userId, record) {
            const plaintext = await decryptCredential(
              record.encryptedSubscription,
              { userId, integrationId: record.id, provider: "web_push" },
              keyProvider
            );
            return PushSubscriptionDataSchema.parse(JSON.parse(plaintext));
          },
          leaseOwner,
          now
        },
        signal
      );
    },
    async processHealth(signal) {
      if (!maritimeClient || !maritimeWorkerAgentId || !maritimeGatewayAgentId) {
        return { status: "idle" };
      }
      const checkedAt = now();
      if (checkedAt.getTime() < nextHealthReconciliationAt) return { status: "idle" };
      if (signal.aborted) throw signal.reason;
      nextHealthReconciliationAt = checkedAt.getTime() + 30_000;
      return reconcileHostedHealth({
        operations,
        client: maritimeClient,
        workerAgentId: maritimeWorkerAgentId,
        gatewayAgentId: maritimeGatewayAgentId,
        environment: maritimeEnvironment,
        now
      });
    }
  });

  return {
    rotationSize: 6,
    processNext: runtime.processNext,
    readiness: () => checkPostgresReadiness(connection, { service: "vera-worker" }),
    close: () => connection.close()
  };
}
