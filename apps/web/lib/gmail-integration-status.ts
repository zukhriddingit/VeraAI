import {
  GMAIL_READONLY_SCOPE,
  GmailIntegrationStatusSchema,
  type GmailIntegrationStatus
} from "@vera/domain";
import type { UserRepositories } from "@vera/db";

export async function getGmailIntegrationStatus(
  repositories: UserRepositories,
  configured: boolean
): Promise<GmailIntegrationStatus> {
  if (!configured) {
    return GmailIntegrationStatusSchema.parse({
      state: "unconfigured",
      accountEmail: null,
      lastSuccessfulUseAt: null,
      scheduledIngestionEnabled: false
    });
  }
  const connection = (await repositories.integrationConnections.list()).find(
    (candidate) => candidate.provider === "google"
  );
  const schedules = await repositories.productionSchedules.list();
  const scheduledIngestionEnabled = schedules.some(
    (schedule) => schedule.kind === "gmail_alert_ingestion" && schedule.state === "enabled"
  );
  if (!connection || connection.status === "disconnected") {
    return GmailIntegrationStatusSchema.parse({
      state: "disconnected",
      accountEmail: null,
      lastSuccessfulUseAt: null,
      scheduledIngestionEnabled
    });
  }
  const state =
    connection.status === "revoked" || connection.status === "reconnect_required"
      ? "revoked"
      : connection.status === "expired"
        ? "expired"
        : connection.grantedScopes.includes(GMAIL_READONLY_SCOPE)
          ? "granted"
          : "missing";
  return GmailIntegrationStatusSchema.parse({
    state,
    accountEmail: connection.displayEmail,
    lastSuccessfulUseAt: connection.lastSuccessfulUseAt,
    scheduledIngestionEnabled
  });
}
