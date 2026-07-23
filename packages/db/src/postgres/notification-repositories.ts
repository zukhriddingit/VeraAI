import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NotificationDeliverySchema,
  NotificationDeliveryStateSchema,
  NotificationPreferenceSchema,
  Sha256Schema,
  VeraUserIdSchema,
  WebPushSubscriptionRecordSchema,
  WebPushSubscriptionStatusSchema,
  type NotificationDelivery,
  type VeraUserId,
  type WebPushSubscriptionRecord
} from "@vera/domain";
import { and, asc, eq } from "drizzle-orm";

import type { UserRepositories } from "../repositories.ts";
import { mapPostgresError, PostgresRepositoryError } from "./errors.ts";
import { notificationDeliveries, notificationPreferences, webPushSubscriptions } from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

export type NotificationPostgresRepositories = Pick<
  UserRepositories,
  "notificationPreferences" | "webPushSubscriptions" | "notificationDeliveries"
>;

function instant(value: string): Date {
  return new Date(value);
}

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

function assertOwner(actual: VeraUserId, expected: VeraUserId): void {
  if (actual !== expected) {
    throw new PostgresRepositoryError(
      "ownership_violation",
      false,
      "The requested record belongs to a different user."
    );
  }
}

function mapSubscription(row: typeof webPushSubscriptions.$inferSelect): WebPushSubscriptionRecord {
  return WebPushSubscriptionRecordSchema.parse({
    id: row.id,
    userId: row.userId,
    endpointHash: row.endpointHash,
    encryptedSubscription: {
      version: row.credentialVersion,
      algorithm: row.credentialAlgorithm,
      keyId: row.credentialKeyId,
      nonce: row.credentialNonce.toString("base64"),
      ciphertext: row.credentialCiphertext.toString("base64"),
      authenticationTag: row.credentialAuthenticationTag.toString("base64")
    },
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null
  });
}

function mapDelivery(row: typeof notificationDeliveries.$inferSelect): NotificationDelivery {
  return NotificationDeliverySchema.parse({
    ...row,
    availableAt: row.availableAt.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  });
}

export function createPostgresNotificationRepositories(
  db: PostgresExecutor,
  userIdInput: VeraUserId
): NotificationPostgresRepositories {
  const userId = VeraUserIdSchema.parse(userIdInput);

  const notificationPreferenceRepository: NotificationPostgresRepositories["notificationPreferences"] =
    {
      async get() {
        const rows = await db
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, userId))
          .limit(1);
        const row = rows[0];
        return row
          ? NotificationPreferenceSchema.parse({
              ...row,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString()
            })
          : null;
      },
      async upsert(input) {
        const preference = NotificationPreferenceSchema.parse(input);
        assertOwner(preference.userId, userId);
        const rows = await operation(() =>
          db
            .insert(notificationPreferences)
            .values({
              ...preference,
              createdAt: instant(preference.createdAt),
              updatedAt: instant(preference.updatedAt)
            })
            .onConflictDoUpdate({
              target: notificationPreferences.userId,
              set: {
                enabled: preference.enabled,
                scoreThreshold: preference.scoreThreshold,
                freshnessMinutes: preference.freshnessMinutes,
                riskCeiling: preference.riskCeiling,
                timezone: preference.timezone,
                quietHoursStart: preference.quietHoursStart,
                quietHoursEnd: preference.quietHoursEnd,
                hourlyLimit: preference.hourlyLimit,
                digestEnabled: preference.digestEnabled,
                updatedAt: instant(preference.updatedAt)
              }
            })
            .returning()
        );
        const row = rows[0];
        if (!row) throw new Error("Notification preference upsert returned no row.");
        return NotificationPreferenceSchema.parse({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString()
        });
      }
    };

  const webPushSubscriptionRepository: NotificationPostgresRepositories["webPushSubscriptions"] = {
    async insert(input) {
      const subscription = WebPushSubscriptionRecordSchema.parse(input);
      assertOwner(subscription.userId, userId);
      const envelope = subscription.encryptedSubscription;
      const rows = await operation(() =>
        db
          .insert(webPushSubscriptions)
          .values({
            userId,
            id: subscription.id,
            endpointHash: subscription.endpointHash,
            credentialVersion: envelope.version,
            credentialAlgorithm: envelope.algorithm,
            credentialKeyId: envelope.keyId,
            credentialNonce: Buffer.from(envelope.nonce, "base64"),
            credentialCiphertext: Buffer.from(envelope.ciphertext, "base64"),
            credentialAuthenticationTag: Buffer.from(envelope.authenticationTag, "base64"),
            status: subscription.status,
            createdAt: instant(subscription.createdAt),
            updatedAt: instant(subscription.updatedAt),
            revokedAt: subscription.revokedAt === null ? null : instant(subscription.revokedAt)
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Web Push subscription insert returned no row.");
      return mapSubscription(row);
    },
    async getById(input) {
      const id = EntityIdSchema.parse(input);
      const rows = await db
        .select()
        .from(webPushSubscriptions)
        .where(and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.id, id)))
        .limit(1);
      return rows[0] ? mapSubscription(rows[0]) : null;
    },
    async getByEndpointHash(input) {
      const endpointHash = Sha256Schema.parse(input);
      const rows = await db
        .select()
        .from(webPushSubscriptions)
        .where(
          and(
            eq(webPushSubscriptions.userId, userId),
            eq(webPushSubscriptions.endpointHash, endpointHash)
          )
        )
        .limit(1);
      return rows[0] ? mapSubscription(rows[0]) : null;
    },
    async list() {
      const rows = await db
        .select()
        .from(webPushSubscriptions)
        .where(eq(webPushSubscriptions.userId, userId))
        .orderBy(asc(webPushSubscriptions.createdAt), asc(webPushSubscriptions.id));
      return rows.map(mapSubscription);
    },
    async transition(idInput, expectedInput, requestedInput, atInput) {
      const id = EntityIdSchema.parse(idInput);
      const expected = WebPushSubscriptionStatusSchema.parse(expectedInput);
      const requested = WebPushSubscriptionStatusSchema.parse(requestedInput);
      const at = instant(IsoDateTimeSchema.parse(atInput));
      if (expected === requested) {
        const existing = await webPushSubscriptionRepository.getById(id);
        if (!existing || existing.status !== expected) {
          throw new PostgresRepositoryError(
            "conflict",
            false,
            "Subscription state changed concurrently."
          );
        }
        return existing;
      }
      if (expected !== "active" || !["revoked", "disabled"].includes(requested)) {
        throw new PostgresRepositoryError(
          "validation",
          false,
          "Unsupported subscription transition."
        );
      }
      const rows = await operation(() =>
        db
          .update(webPushSubscriptions)
          .set({ status: requested, revokedAt: requested === "revoked" ? at : null, updatedAt: at })
          .where(
            and(
              eq(webPushSubscriptions.userId, userId),
              eq(webPushSubscriptions.id, id),
              eq(webPushSubscriptions.status, expected)
            )
          )
          .returning()
      );
      const row = rows[0];
      if (!row)
        throw new PostgresRepositoryError(
          "conflict",
          false,
          "Subscription state changed concurrently."
        );
      return mapSubscription(row);
    }
  };

  const notificationDeliveryRepository: NotificationPostgresRepositories["notificationDeliveries"] =
    {
      async enqueue(input) {
        const delivery = NotificationDeliverySchema.parse(input);
        assertOwner(delivery.userId, userId);
        const inserted = await operation(() =>
          db
            .insert(notificationDeliveries)
            .values({
              ...delivery,
              availableAt: instant(delivery.availableAt),
              leaseExpiresAt:
                delivery.leaseExpiresAt === null ? null : instant(delivery.leaseExpiresAt),
              deliveredAt: delivery.deliveredAt === null ? null : instant(delivery.deliveredAt),
              createdAt: instant(delivery.createdAt),
              updatedAt: instant(delivery.updatedAt)
            })
            .onConflictDoNothing({
              target: [notificationDeliveries.userId, notificationDeliveries.idempotencyKey]
            })
            .returning()
        );
        const rows =
          inserted.length > 0
            ? inserted
            : await db
                .select()
                .from(notificationDeliveries)
                .where(
                  and(
                    eq(notificationDeliveries.userId, userId),
                    eq(notificationDeliveries.idempotencyKey, delivery.idempotencyKey)
                  )
                )
                .limit(1);
        const row = rows[0];
        if (!row) throw new Error("Notification delivery did not resolve.");
        return { record: mapDelivery(row), inserted: inserted.length === 1 };
      },
      async getById(input) {
        const id = EntityIdSchema.parse(input);
        const rows = await db
          .select()
          .from(notificationDeliveries)
          .where(and(eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.id, id)))
          .limit(1);
        return rows[0] ? mapDelivery(rows[0]) : null;
      },
      async getByIdempotencyKey(input) {
        const key = Sha256Schema.parse(input);
        const rows = await db
          .select()
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.userId, userId),
              eq(notificationDeliveries.idempotencyKey, key)
            )
          )
          .limit(1);
        return rows[0] ? mapDelivery(rows[0]) : null;
      },
      async list() {
        const rows = await db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.userId, userId))
          .orderBy(asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id));
        return rows.map(mapDelivery);
      },
      async transition(
        idInput,
        expectedInput,
        requestedInput,
        atInput,
        safeErrorCode = null,
        availableAtInput
      ) {
        const id = EntityIdSchema.parse(idInput);
        const expected = NotificationDeliveryStateSchema.parse(expectedInput);
        const requested = NotificationDeliveryStateSchema.parse(requestedInput);
        const at = instant(IsoDateTimeSchema.parse(atInput));
        const availableAt =
          availableAtInput === undefined
            ? undefined
            : instant(IsoDateTimeSchema.parse(availableAtInput));
        const failure = ["retryable_failed", "permanently_failed"].includes(requested);
        const rows = await operation(() =>
          db
            .update(notificationDeliveries)
            .set({
              state: requested,
              availableAt,
              leaseOwner: null,
              leaseExpiresAt: null,
              deliveredAt: requested === "delivered" ? at : null,
              safeErrorCode: failure ? EntityIdSchema.parse(safeErrorCode) : null,
              updatedAt: at
            })
            .where(
              and(
                eq(notificationDeliveries.userId, userId),
                eq(notificationDeliveries.id, id),
                eq(notificationDeliveries.state, expected)
              )
            )
            .returning()
        );
        const row = rows[0];
        if (!row)
          throw new PostgresRepositoryError(
            "conflict",
            false,
            "Notification state changed concurrently."
          );
        return mapDelivery(row);
      }
    };

  return {
    notificationPreferences: notificationPreferenceRepository,
    webPushSubscriptions: webPushSubscriptionRepository,
    notificationDeliveries: notificationDeliveryRepository
  };
}
