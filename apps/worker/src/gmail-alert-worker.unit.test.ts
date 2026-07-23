import { GmailAlertConnector, MockGmailClient } from "@vera/connectors";
import { sha256Text, type UserRepositories, type UserRepositoryProvider } from "@vera/db";
import type {
  GmailAlertCursor,
  GmailAlertExternalReferenceRecord,
  RawListing,
  VeraUserId
} from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { runGmailAlertIngestion } from "./gmail-alert-worker.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;

function fixtureConnector() {
  return new GmailAlertConnector(
    new MockGmailClient({
      latestHistoryId: "101",
      messages: [
        {
          messageId: "gmail-message-1",
          historyId: "101",
          internalDate: "2026-07-22T12:00:00.000Z",
          from: "alerts@zillow.com",
          subject: "New listing",
          bodyText: "123 Main St is $2,400. https://www.zillow.com/homedetails/123_zpid/"
        }
      ]
    }),
    {
      label: "Vera",
      allowedSenders: ["alerts@zillow.com"],
      subjectTerms: ["New listing"],
      maxResults: 10
    }
  );
}

describe("Gmail alert worker", () => {
  it("imports immutably, enqueues normalization, and replays a message idempotently", async () => {
    const rawByHash = new Map<string, RawListing>();
    const references = new Map<string, GmailAlertExternalReferenceRecord>();
    let cursor: GmailAlertCursor | null = null;
    const enqueue = vi.fn(async (input) => ({ record: input, inserted: true }));
    const append = vi.fn(async (event) => event);
    const repositories = {
      rawListings: {
        async import(capture: Parameters<UserRepositories["rawListings"]["import"]>[0]) {
          const contentHash = sha256Text(JSON.stringify(capture.rawJson));
          const existing = rawByHash.get(contentHash);
          if (existing) return { record: existing, inserted: false };
          const record: RawListing = {
            ...capture,
            contentHash,
            idempotencyKey: sha256Text(`raw:${contentHash}`),
            createdAt: capture.observedAt
          };
          rawByHash.set(contentHash, record);
          return { record, inserted: true };
        }
      },
      normalizationJobs: { enqueue },
      gmailAlertExternalReferences: {
        async getByMessageId(messageId: string) {
          return references.get(messageId) ?? null;
        },
        async insert(reference: GmailAlertExternalReferenceRecord) {
          references.set(reference.messageId, reference);
          return reference;
        }
      },
      gmailAlertCursors: {
        async getBySourceConfigurationId() {
          return cursor;
        },
        async upsert(value: GmailAlertCursor) {
          cursor = value;
          return value;
        }
      },
      activityEvents: { append }
    } as unknown as UserRepositories;
    const provider: UserRepositoryProvider = {
      forUser: () => repositories,
      async transaction(_userId, operation) {
        return operation(repositories);
      }
    };
    let sequence = 0;
    const dependencies = {
      userId: USER_ID,
      sourceConfigurationId: "gmail-source-1",
      repositoryProvider: provider,
      connector: fixtureConnector(),
      correlationId: "gmail-correlation-1",
      now: () => new Date("2026-07-22T12:01:00.000Z"),
      createId: () => `gmail-id-${++sequence}`
    };

    await expect(runGmailAlertIngestion(dependencies)).resolves.toMatchObject({
      status: "completed",
      imported: 1,
      replayed: 0,
      cursor: "101"
    });
    await expect(
      runGmailAlertIngestion({ ...dependencies, connector: fixtureConnector() })
    ).resolves.toMatchObject({ status: "completed", imported: 0, replayed: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(2);
    expect(cursor).toMatchObject({ historyId: "101" });
  });
});
