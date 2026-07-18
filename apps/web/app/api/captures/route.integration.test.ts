import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSqliteRepositories, migrateDatabase, openDatabase, seedDatabase } from "@vera/db";
import { CaptureAcceptedResponseSchema, CaptureErrorResponseSchema } from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "./route.ts";

let dataDirectory = "";
const originalDataDirectory = process.env.VERA_DATA_DIR;
const originalKillSwitches = process.env.VERA_ACTIVE_KILL_SWITCHES;

function jsonRequest(payload: unknown): Request {
  return new Request("http://127.0.0.1:3000/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

function withRepositories<T>(
  callback: (repositories: ReturnType<typeof createSqliteRepositories>) => T
): T {
  const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });

  try {
    return callback(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
}

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), "vera-capture-route-"));
  process.env.VERA_DATA_DIR = dataDirectory;
  const connection = openDatabase({ filePath: join(dataDirectory, "vera.sqlite") });

  try {
    migrateDatabase(connection);
    seedDatabase(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
});

afterEach(() => {
  if (originalDataDirectory === undefined) {
    delete process.env.VERA_DATA_DIR;
  } else {
    process.env.VERA_DATA_DIR = originalDataDirectory;
  }
  if (originalKillSwitches === undefined) {
    delete process.env.VERA_ACTIVE_KILL_SWITCHES;
  } else {
    process.env.VERA_ACTIVE_KILL_SWITCHES = originalKillSwitches;
  }
  rmSync(dataDirectory, { recursive: true, force: true });
});

describe.sequential("POST /api/captures", () => {
  it("captures pasted text, applies policy, and queues normalization", async () => {
    const response = await POST(
      jsonRequest({
        kind: "manual_text",
        sourceUrl: "https://housing.example/listings/synthetic-1",
        listingText:
          "Title: Synthetic garden flat\nRent: $2,450\n1 bed · 1 bath\nAddress: 101 Example Way\nPosted: 2026-07-17\nContact me through the platform"
      })
    );
    const result = CaptureAcceptedResponseSchema.parse(await response.json());

    expect(response.status).toBe(202);
    expect(result).toMatchObject({ duplicate: false, normalizationState: "queued" });
    withRepositories((repositories) => {
      expect(repositories.rawListings.count()).toBe(13);
      expect(repositories.normalizationJobs.count()).toBe(1);
      const events = repositories.activityEvents
        .list()
        .filter((event) => event.correlationId === result.correlationId);
      const requested = events.find((event) => event.action === "capture.requested");
      const authorized = events.find((event) => event.action === "capture.policy_authorized");
      const completed = events.find((event) => event.action === "capture.completed");
      expect(events).toHaveLength(3);
      expect(authorized?.causationId).toBe(requested?.id);
      expect(completed?.causationId).toBe(authorized?.id);
      expect(repositories.rawListings.getById(result.rawListingId)?.source).toBe("other");
    });
  });

  it("reuses identical evidence without a second raw row or job", async () => {
    const payload = {
      kind: "manual_text",
      sourceUrl: "https://www.zillow.com/homedetails/synthetic-2",
      listingText: "Rent: $2,200\n2 beds\n1 bath"
    };
    const first = CaptureAcceptedResponseSchema.parse(
      await (await POST(jsonRequest(payload))).json()
    );
    const second = CaptureAcceptedResponseSchema.parse(
      await (await POST(jsonRequest(payload))).json()
    );

    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({
      rawListingId: first.rawListingId,
      normalizationJobId: first.normalizationJobId,
      duplicate: true
    });
    withRepositories((repositories) => {
      expect(repositories.rawListings.count()).toBe(13);
      expect(repositories.normalizationJobs.count()).toBe(1);
    });
  });

  it("rejects malformed payloads and appends requested and failed events", async () => {
    const response = await POST(
      jsonRequest({ kind: "manual_text", sourceUrl: "https://housing.example/listing" })
    );
    const error = CaptureErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(error.code).toBe("malformed_request");
    withRepositories((repositories) => {
      const events = repositories.activityEvents
        .list()
        .filter((event) => event.correlationId === error.correlationId);
      const requested = events.find((event) => event.action === "capture.requested");
      const failed = events.find((event) => event.action === "capture.failed");
      expect(events).toHaveLength(2);
      expect(failed?.causationId).toBe(requested?.id);
    });
  });

  it("rejects an oversized request as malformed without storing raw evidence", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(260_001)
      })
    );
    const error = CaptureErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(error.code).toBe("malformed_request");
    withRepositories((repositories) => {
      expect(repositories.rawListings.count()).toBe(12);
      expect(repositories.normalizationJobs.count()).toBe(0);
    });
  });

  it("rejects unsupported structured source labels", async () => {
    const response = await POST(
      jsonRequest({
        kind: "manual_structured",
        listing: { source: "unsupported", title: "Synthetic record" }
      })
    );
    const error = CaptureErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(422);
    expect(error.code).toBe("unsupported_source");
  });

  it("fails closed under a connector kill switch and audits the denial", async () => {
    process.env.VERA_ACTIVE_KILL_SWITCHES = "connectors.manual.capture.v1.disabled";
    const response = await POST(
      jsonRequest({
        kind: "manual_text",
        sourceUrl: "https://housing.example/listing",
        listingText: "Rent: $1,900"
      })
    );
    const error = CaptureErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(403);
    expect(error.code).toBe("policy_denied");
    withRepositories((repositories) => {
      const events = repositories.activityEvents
        .list()
        .filter((event) => event.correlationId === error.correlationId);
      const requested = events.find((event) => event.action === "capture.requested");
      const denied = events.find((event) => event.action === "capture.policy_denied");
      const failed = events.find((event) => event.action === "capture.failed");
      expect(events).toHaveLength(3);
      expect(denied?.causationId).toBe(requested?.id);
      expect(failed?.causationId).toBe(denied?.id);
      expect(repositories.rawListings.count()).toBe(12);
    });
  });

  it("rejects SSRF-shaped provenance without attempting a fetch", async () => {
    const response = await POST(
      jsonRequest({
        kind: "manual_text",
        sourceUrl: "http://127.0.0.1/internal",
        listingText: "Rent: $1,900"
      })
    );
    const error = CaptureErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(error.code).toBe("malformed_request");
    withRepositories((repositories) => {
      expect(repositories.rawListings.count()).toBe(12);
      const events = repositories.activityEvents
        .list()
        .filter((event) => event.correlationId === error.correlationId);
      const requested = events.find((event) => event.action === "capture.requested");
      const authorized = events.find((event) => event.action === "capture.policy_authorized");
      const failed = events.find((event) => event.action === "capture.failed");
      expect(events).toHaveLength(3);
      expect(authorized?.causationId).toBe(requested?.id);
      expect(failed?.causationId).toBe(authorized?.id);
    });
  });
});
