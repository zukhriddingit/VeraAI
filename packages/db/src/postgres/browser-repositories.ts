import {
  BrowserCaptureAcceptanceSchema,
  BrowserIntegrationControlSchema,
  BrowserProfileControlSchema,
  BrowserProfileIdSchema,
  EntityIdSchema,
  Sha256Schema,
  type VeraUserId
} from "@vera/domain";
import { and, eq } from "drizzle-orm";

import type { UserRepositories } from "../repositories.ts";
import { mapPostgresError } from "./errors.ts";
import {
  browserCaptureAcceptances,
  browserProfileControls,
  browserSourceControls,
  browserUserControls
} from "./schema.ts";
import type { PostgresExecutor } from "./types.ts";

const ZILLOW_CONNECTOR_ID = "zillow.current-tab.v1";
const DISABLED_SINCE = "1970-01-01T00:00:00.000Z";

export type BrowserPostgresRepositories = Pick<
  UserRepositories,
  "browserIntegrationControls" | "browserProfileControls" | "browserCaptureAcceptances"
>;

function instant(value: string): Date {
  return new Date(value);
}

function toIso(value: Date): string {
  return value.toISOString();
}

async function operation<Result>(callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error: unknown) {
    throw mapPostgresError(error);
  }
}

export function createPostgresBrowserRepositories(
  db: PostgresExecutor,
  userId: VeraUserId
): BrowserPostgresRepositories {
  const browserIntegrationControls: BrowserPostgresRepositories["browserIntegrationControls"] = {
    async get() {
      const [userRows, sourceRows] = await Promise.all([
        db
          .select()
          .from(browserUserControls)
          .where(eq(browserUserControls.userId, userId))
          .limit(1),
        db
          .select()
          .from(browserSourceControls)
          .where(
            and(
              eq(browserSourceControls.userId, userId),
              eq(browserSourceControls.connectorId, ZILLOW_CONNECTOR_ID)
            )
          )
          .limit(1)
      ]);
      const user = userRows[0];
      const source = sourceRows[0];
      const updatedAt = [user?.updatedAt, source?.updatedAt]
        .filter((value): value is Date => value !== undefined)
        .sort((left, right) => right.getTime() - left.getTime())[0];
      return BrowserIntegrationControlSchema.parse({
        userBrowserEnabled: user?.enabled ?? false,
        zillowSourceEnabled: source?.enabled ?? false,
        updatedAt: updatedAt?.toISOString() ?? DISABLED_SINCE
      });
    },
    async upsert(input) {
      const control = BrowserIntegrationControlSchema.parse(input);
      await operation(async () => {
        await db
          .insert(browserUserControls)
          .values({
            userId,
            enabled: control.userBrowserEnabled,
            updatedAt: instant(control.updatedAt)
          })
          .onConflictDoUpdate({
            target: browserUserControls.userId,
            set: { enabled: control.userBrowserEnabled, updatedAt: instant(control.updatedAt) }
          });
        await db
          .insert(browserSourceControls)
          .values({
            userId,
            connectorId: ZILLOW_CONNECTOR_ID,
            enabled: control.zillowSourceEnabled,
            updatedAt: instant(control.updatedAt)
          })
          .onConflictDoUpdate({
            target: [browserSourceControls.userId, browserSourceControls.connectorId],
            set: { enabled: control.zillowSourceEnabled, updatedAt: instant(control.updatedAt) }
          });
      });
      return browserIntegrationControls.get();
    }
  };

  const browserProfileControlRepository: BrowserPostgresRepositories["browserProfileControls"] = {
    async get(nodeIdInput, profileIdInput) {
      const nodeId = EntityIdSchema.parse(nodeIdInput);
      const profileId = BrowserProfileIdSchema.parse(profileIdInput);
      const rows = await db
        .select()
        .from(browserProfileControls)
        .where(
          and(
            eq(browserProfileControls.userId, userId),
            eq(browserProfileControls.nodeId, nodeId),
            eq(browserProfileControls.profileId, profileId)
          )
        )
        .limit(1);
      const row = rows[0];
      return row
        ? BrowserProfileControlSchema.parse({
            nodeId: row.nodeId,
            profileId: row.profileId,
            disabledAt: row.disabledAt?.toISOString() ?? null,
            updatedAt: row.updatedAt.toISOString()
          })
        : null;
    },
    async upsert(input) {
      const control = BrowserProfileControlSchema.parse(input);
      const rows = await operation(() =>
        db
          .insert(browserProfileControls)
          .values({
            userId,
            nodeId: control.nodeId,
            profileId: control.profileId,
            disabledAt: control.disabledAt === null ? null : instant(control.disabledAt),
            updatedAt: instant(control.updatedAt)
          })
          .onConflictDoUpdate({
            target: [
              browserProfileControls.userId,
              browserProfileControls.nodeId,
              browserProfileControls.profileId
            ],
            set: {
              disabledAt: control.disabledAt === null ? null : instant(control.disabledAt),
              updatedAt: instant(control.updatedAt)
            }
          })
          .returning()
      );
      const row = rows[0];
      if (!row) throw new Error("Browser profile control upsert returned no row.");
      return BrowserProfileControlSchema.parse({
        nodeId: row.nodeId,
        profileId: row.profileId,
        disabledAt: row.disabledAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString()
      });
    }
  };

  function mapAcceptance(row: typeof browserCaptureAcceptances.$inferSelect) {
    return BrowserCaptureAcceptanceSchema.parse({
      id: row.id,
      sourceJobId: row.sourceJobId,
      attemptId: row.attemptId,
      nodeId: row.nodeId,
      profileId: row.profileId,
      payloadHash: row.payloadHash,
      invocationIdempotencyKey: row.invocationIdempotencyKey,
      resultHash: row.resultHash,
      contentHash: row.contentHash,
      canonicalUrl: row.canonicalUrl,
      rawListingId: row.rawListingId,
      acceptedAt: toIso(row.acceptedAt)
    });
  }

  const browserCaptureAcceptanceRepository: BrowserPostgresRepositories["browserCaptureAcceptances"] =
    {
      async insert(input) {
        const acceptance = BrowserCaptureAcceptanceSchema.parse(input);
        const rows = await operation(() =>
          db
            .insert(browserCaptureAcceptances)
            .values({ userId, ...acceptance, acceptedAt: instant(acceptance.acceptedAt) })
            .returning()
        );
        const row = rows[0];
        if (!row) throw new Error("Browser capture acceptance insert returned no row.");
        return mapAcceptance(row);
      },
      async getById(input) {
        const id = EntityIdSchema.parse(input);
        const rows = await db
          .select()
          .from(browserCaptureAcceptances)
          .where(
            and(eq(browserCaptureAcceptances.userId, userId), eq(browserCaptureAcceptances.id, id))
          )
          .limit(1);
        return rows[0] ? mapAcceptance(rows[0]) : null;
      },
      async getBySourceJobId(input) {
        const sourceJobId = EntityIdSchema.parse(input);
        const rows = await db
          .select()
          .from(browserCaptureAcceptances)
          .where(
            and(
              eq(browserCaptureAcceptances.userId, userId),
              eq(browserCaptureAcceptances.sourceJobId, sourceJobId)
            )
          )
          .limit(1);
        return rows[0] ? mapAcceptance(rows[0]) : null;
      },
      async getByInvocationIdempotencyKey(input) {
        const key = Sha256Schema.parse(input);
        const rows = await db
          .select()
          .from(browserCaptureAcceptances)
          .where(
            and(
              eq(browserCaptureAcceptances.userId, userId),
              eq(browserCaptureAcceptances.invocationIdempotencyKey, key)
            )
          )
          .limit(1);
        return rows[0] ? mapAcceptance(rows[0]) : null;
      }
    };

  return {
    browserIntegrationControls,
    browserProfileControls: browserProfileControlRepository,
    browserCaptureAcceptances: browserCaptureAcceptanceRepository
  };
}
