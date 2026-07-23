import { SourcePolicyRegistry } from "@vera/policy";
import { describe, expect, it } from "vitest";

import { GmailAlertConnector } from "./gmail-alert-connector.ts";
import { MockGmailClient } from "./gmail-client.ts";

const manifest = {
  schemaVersion: 2 as const,
  connectorId: "google.gmail.listing-alerts.v1",
  displayName: "Gmail listing alerts",
  version: 1,
  source: "other" as const,
  acquisitionMode: "email_alert" as const,
  policyState: "approved" as const,
  enabled: true,
  execution: "scheduled" as const,
  capabilities: ["gmail.alert.read" as const],
  allowedOperations: ["gmail.alert.read_configured"],
  allowedDomains: ["gmail.googleapis.com"],
  allowedOrigins: ["https://gmail.googleapis.com/"],
  allowedHttpMethods: ["GET" as const],
  requiresUserSession: true,
  requiresApproval: false,
  minimumIntervalSeconds: 300,
  maxConcurrency: 1,
  globalKillSwitchKey: "integrations.disabled",
  connectorKillSwitchKey: "connectors.google.gmail.listing-alerts.v1.disabled",
  dataClassification: "third_party" as const,
  redactionRules: ["raw_content_from_logs" as const, "contact_details_from_logs" as const],
  manualBlockerBehavior: "stop_and_request_user_action" as const,
  owner: "Vera maintainers",
  reviewedAt: "2026-07-22",
  decisionRecord: "docs/DECISIONS/0011-maritime-production-execution.md",
  notes: "Read-only configured Gmail listing-alert ingestion.",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z"
};

describe("GmailAlertConnector", () => {
  it("converts a bounded sanitized message into untrusted email-alert evidence", async () => {
    const client = new MockGmailClient({
      latestHistoryId: "42",
      messages: [
        {
          messageId: "gmail-message-1",
          historyId: "42",
          internalDate: "2026-07-22T12:00:00.000Z",
          from: "alerts@zillow.com",
          subject: "New listing near Cambridge",
          bodyText: "123 Main St is now $2,400. https://www.zillow.com/homedetails/123_zpid/"
        }
      ]
    });
    const connector = new GmailAlertConnector(client, {
      label: "Vera",
      allowedSenders: ["alerts@zillow.com"],
      subjectTerms: ["New listing"],
      maxResults: 10
    });

    const records = await connector.discover(
      { sourceConfigurationId: "gmail-source-1", cursor: null },
      {
        correlationId: "correlation-1",
        now: () => new Date("2026-07-22T12:01:00.000Z"),
        createId: () => "id-1"
      }
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "zillow",
      acquisitionMode: "email_alert",
      sourceUrl: "https://www.zillow.com/homedetails/123_zpid/",
      captureMethod: "email_alert",
      captureMetadata: { untrustedContent: true }
    });
    expect(connector.cursorState?.value).toBe("42");
    expect(JSON.stringify(records)).not.toContain("alerts@zillow.com");
  });

  it("fails closed when source policy disables the connector", () => {
    const connector = new GmailAlertConnector(
      new MockGmailClient({ messages: [], latestHistoryId: null }),
      { label: "Vera", allowedSenders: [], subjectTerms: [], maxResults: 10 }
    );
    const registry = new SourcePolicyRegistry([{ ...manifest, enabled: false }]);
    expect(connector.health(registry)).toMatchObject({ status: "disabled" });
  });
});
