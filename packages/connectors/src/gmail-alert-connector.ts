import type { SourcePolicyRegistry } from "@vera/policy";
import { z } from "zod";

import {
  ConnectorHealthSchema,
  RawListingEnvelopeSchema,
  type ConnectorContext,
  type ConnectorDiscoveryRequest,
  type ConnectorHealth,
  type RawListingEnvelope,
  type SourceConnector
} from "./contracts.ts";
import type { GmailAlertMessage, GmailClient } from "./gmail-client.ts";

export const GMAIL_ALERT_CONNECTOR_ID = "google.gmail.listing-alerts.v1";

export const GmailAlertEvidenceSchema = z
  .object({
    gmailMessageId: z.string().trim().min(1).max(256),
    gmailHistoryId: z.string().regex(/^\d+$/u).max(64).nullable(),
    subject: z.string().trim().min(1).max(500),
    listingUrl: z.string().url().max(2_048).nullable(),
    explicitPriceText: z.string().trim().min(1).max(100).nullable(),
    explicitAddressText: z.string().trim().min(1).max(300).nullable(),
    excerpt: z.string().trim().min(1).max(2_000)
  })
  .strict();

const SOURCE_HOSTS = [
  { source: "zillow", host: "zillow.com" },
  { source: "apartments_com", host: "apartments.com" },
  { source: "craigslist", host: "craigslist.org" },
  { source: "facebook_marketplace", host: "facebook.com" }
] as const;

function firstListingUrl(text: string): URL | null {
  const matches = text.matchAll(/https:\/\/[^\s<>"')\]]+/giu);
  for (const match of matches) {
    try {
      const url = new URL((match[0] ?? "").replace(/[.,;!?]+$/u, ""));
      if (url.username || url.password || url.port || url.hash) continue;
      if (
        SOURCE_HOSTS.some(({ host }) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      ) {
        return url;
      }
    } catch {
      // Untrusted message fragments are ignored unless they form a reviewed HTTPS URL.
    }
  }
  return null;
}

function sourceFor(url: URL | null, from: string): RawListingEnvelope["source"] {
  const candidate = `${url?.hostname ?? ""} ${from}`.toLowerCase();
  return (
    SOURCE_HOSTS.find(({ host }) => candidate.includes(host.replace(".org", "")))?.source ?? "other"
  );
}

function compactEvidence(message: GmailAlertMessage, url: URL | null) {
  const price = message.bodyText.match(/\$\s?([0-9]{3,6}(?:,[0-9]{3})?)(?:\.00)?/u)?.[0] ?? null;
  const address =
    message.bodyText.match(
      /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,80}\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court)\b[^\n,]*/iu
    )?.[0] ?? null;
  return GmailAlertEvidenceSchema.parse({
    gmailMessageId: message.messageId,
    gmailHistoryId: message.historyId,
    subject: message.subject,
    listingUrl: url?.href ?? null,
    explicitPriceText: price,
    explicitAddressText: address,
    excerpt: message.bodyText.slice(0, 2_000)
  });
}

export class GmailAlertConnector implements SourceConnector {
  readonly connectorId = GMAIL_ALERT_CONNECTOR_ID;
  readonly displayName = "Gmail listing alerts";
  readonly source = "other" as const;
  readonly acquisitionMode = "email_alert" as const;
  readonly capability = "gmail.alert.read" as const;
  readonly policyRequirement = {
    connectorId: this.connectorId,
    acquisitionMode: this.acquisitionMode,
    capability: this.capability,
    operation: "gmail.alert.read_configured"
  } as const;
  readonly operations = ["discover"] as const;

  constructor(
    private readonly client: GmailClient,
    private readonly query: {
      readonly label: "Vera" | null;
      readonly allowedSenders: readonly string[];
      readonly subjectTerms: readonly string[];
      readonly maxResults: number;
    },
    private currentCursor: SourceConnector["cursorState"] = null
  ) {}

  get cursorState() {
    return this.currentCursor;
  }

  async discover(
    request: ConnectorDiscoveryRequest,
    context: ConnectorContext
  ): Promise<readonly RawListingEnvelope[]> {
    this.currentCursor = request.cursor;
    const batch = await this.client.searchListingAlerts(
      {
        ...this.query,
        allowedSenders: [...this.query.allowedSenders],
        subjectTerms: [...this.query.subjectTerms],
        afterHistoryId: this.currentCursor?.value ?? null
      },
      context.signal
    );
    const observed = context.now();
    if (Number.isNaN(observed.getTime())) throw new Error("Gmail connector clock is invalid.");
    if (batch.latestHistoryId !== null) {
      this.currentCursor = { value: batch.latestHistoryId, observedAt: observed.toISOString() };
    }
    return batch.messages.map((message) => {
      const url = firstListingUrl(message.bodyText);
      const evidence = compactEvidence(message, url);
      return RawListingEnvelopeSchema.parse({
        connectorId: this.connectorId,
        capability: this.capability,
        acquisitionMode: this.acquisitionMode,
        source: sourceFor(url, message.from),
        sourceListingId: null,
        sourceUrl: url?.href ?? null,
        captureMethod: "email_alert",
        observedAt: observed.toISOString(),
        sourcePostedAt: message.internalDate,
        rawText: `${message.subject}\n${evidence.excerpt}`,
        rawJson: evidence,
        captureMetadata: {
          networkAccess: true,
          untrustedContent: true,
          browserAccess: "not_applicable"
        }
      });
    });
  }

  health(registry: SourcePolicyRegistry): ConnectorHealth {
    const decision = registry.evaluate({
      connectorId: this.connectorId,
      acquisitionMode: this.acquisitionMode,
      capability: this.capability,
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
    return ConnectorHealthSchema.parse({
      connectorId: this.connectorId,
      displayName: this.displayName,
      status: decision.allowed
        ? "ready"
        : decision.reason === "connector_disabled"
          ? "disabled"
          : "denied",
      capabilities: [this.capability],
      networkAccess: true,
      detail: decision.allowed
        ? "Reads only configured listing-alert matches through Gmail readonly."
        : `Denied by source policy: ${decision.reason}.`
    });
  }
}
