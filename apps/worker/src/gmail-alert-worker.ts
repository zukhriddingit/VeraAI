import { GmailAlertEvidenceSchema, GmailClientError } from "@vera/connectors";
import type { GmailAlertConnector } from "@vera/connectors";
import { canonicalJson, sha256Text, type UserRepositoryProvider } from "@vera/db";
import {
  ActivityEventSchema,
  EntityIdSchema,
  type RawListingCapture,
  type VeraUserId
} from "@vera/domain";

export interface GmailAlertWorkerDependencies {
  readonly userId: VeraUserId;
  readonly sourceConfigurationId: string;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly connector: GmailAlertConnector;
  readonly correlationId: string;
  now(): Date;
  createId(): string;
}

export type GmailAlertWorkerResult =
  | {
      readonly status: "completed";
      readonly imported: number;
      readonly replayed: number;
      readonly cursor: string | null;
    }
  | { readonly status: "retryable_failed"; readonly safeErrorCode: string }
  | { readonly status: "permanently_failed"; readonly safeErrorCode: string };

export async function runGmailAlertIngestion(
  dependencies: GmailAlertWorkerDependencies,
  signal?: AbortSignal
): Promise<GmailAlertWorkerResult> {
  const sourceConfigurationId = EntityIdSchema.parse(dependencies.sourceConfigurationId);
  const correlationId = EntityIdSchema.parse(dependencies.correlationId);
  const observedAt = dependencies.now();
  if (Number.isNaN(observedAt.getTime())) throw new Error("Gmail worker clock is invalid.");
  const repositories = dependencies.repositoryProvider.forUser(dependencies.userId);
  const existingCursor =
    await repositories.gmailAlertCursors.getBySourceConfigurationId(sourceConfigurationId);

  try {
    const records = await dependencies.connector.discover(
      {
        sourceConfigurationId,
        cursor:
          existingCursor?.historyId === null || existingCursor === null
            ? null
            : { value: existingCursor.historyId, observedAt: existingCursor.updatedAt }
      },
      signal === undefined
        ? { correlationId, now: dependencies.now, createId: dependencies.createId }
        : { correlationId, signal, now: dependencies.now, createId: dependencies.createId }
    );
    const cursor = dependencies.connector.cursorState?.value ?? existingCursor?.historyId ?? null;
    let imported = 0;
    let replayed = 0;

    await dependencies.repositoryProvider.transaction(
      dependencies.userId,
      async (transactionRepositories) => {
        for (const envelope of records) {
          if (signal?.aborted) throw signal.reason;
          const metadata = GmailAlertEvidenceSchema.parse(envelope.rawJson);
          const existing =
            await transactionRepositories.gmailAlertExternalReferences.getByMessageId(
              metadata.gmailMessageId
            );
          if (existing !== null) {
            replayed += 1;
            continue;
          }
          const capture: RawListingCapture = {
            id: dependencies.createId(),
            source: envelope.source,
            acquisitionMode: "email_alert",
            sourceListingId: envelope.sourceListingId,
            sourceUrl: envelope.sourceUrl,
            captureMethod: "email_alert",
            observedAt: envelope.observedAt,
            sourcePostedAt: envelope.sourcePostedAt,
            rawText: envelope.rawText,
            rawJson: envelope.rawJson,
            captureMetadata: envelope.captureMetadata
          };
          const rawImport = await transactionRepositories.rawListings.import(capture);
          await transactionRepositories.gmailAlertExternalReferences.insert({
            id: dependencies.createId(),
            userId: dependencies.userId,
            messageId: metadata.gmailMessageId,
            historyId: metadata.gmailHistoryId,
            rawListingId: rawImport.record.id,
            contentHash: rawImport.record.contentHash,
            importedAt: envelope.observedAt
          });
          if (rawImport.inserted) {
            await transactionRepositories.normalizationJobs.enqueue({
              id: dependencies.createId(),
              rawListingId: rawImport.record.id,
              idempotencyKey: sha256Text(
                `gmail-normalization:v1:${dependencies.userId}:${rawImport.record.id}`
              ),
              availableAt: envelope.observedAt,
              maxAttempts: 3,
              correlationId,
              causationId: sourceConfigurationId,
              createdAt: envelope.observedAt
            });
            imported += 1;
          } else {
            replayed += 1;
          }
        }

        const completedAt = dependencies.now().toISOString();
        await transactionRepositories.gmailAlertCursors.upsert({
          id: existingCursor?.id ?? dependencies.createId(),
          userId: dependencies.userId,
          sourceConfigurationId,
          historyId: cursor,
          lastSuccessfulAt: completedAt,
          updatedAt: completedAt
        });
        const auditMetadata = {
          imported,
          replayed,
          cursorAdvanced: cursor !== existingCursor?.historyId
        };
        await transactionRepositories.activityEvents.append(
          ActivityEventSchema.parse({
            id: dependencies.createId(),
            correlationId,
            causationId: sourceConfigurationId,
            actor: "connector",
            action: "gmail.alert_ingestion.completed",
            targetType: "source_configuration",
            targetId: sourceConfigurationId,
            policyDecision: "authorized",
            approvalId: null,
            payloadHash: sha256Text(canonicalJson(auditMetadata)),
            outcome: "succeeded",
            errorCategory: null,
            metadata: auditMetadata,
            occurredAt: completedAt
          })
        );
      }
    );
    return { status: "completed", imported, replayed, cursor };
  } catch (error: unknown) {
    if (signal?.aborted) throw error;
    if (error instanceof GmailClientError) {
      return {
        status: error.retryable ? "retryable_failed" : "permanently_failed",
        safeErrorCode: error.code
      };
    }
    return { status: "permanently_failed", safeErrorCode: "gmail_ingestion_failed" };
  }
}
