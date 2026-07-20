import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedEvidenceDatabase
} from "@vera/db";
import {
  CreateDuplicateOverrideResponseSchema,
  DecisionApiErrorResponseSchema,
  DecisionJobSummarySchema,
  DuplicateOverrideHistoryResponseSchema
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getDecisionJob } from "./decision-jobs/[id]/route.ts";
import { GET as getOverrides, POST as createOverride } from "./dedupe/overrides/route.ts";

const originalDataDirectory = process.env.VERA_DATA_DIR;
let directory = "";

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-decision-routes-"));
  process.env.VERA_DATA_DIR = directory;
  const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });

  try {
    migrateDatabase(connection);
    seedEvidenceDatabase(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
});

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.VERA_DATA_DIR;
  else process.env.VERA_DATA_DIR = originalDataDirectory;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

function postOverride(body: unknown): Promise<Response> {
  return createOverride(
    new Request("http://127.0.0.1/api/dedupe/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe.sequential("decision operator routes", () => {
  it("records an immutable split override and queues its own corpus revision", async () => {
    const beforeResponse = await getOverrides();
    const before = DuplicateOverrideHistoryResponseSchema.parse(await beforeResponse.json());
    expect(beforeResponse.status).toBe(200);
    expect(before.overrides).toEqual([]);

    const response = await postOverride({
      kind: "force_split",
      sourceRecordIds: ["src-juniper-apartments", "src-juniper-zillow"],
      survivorCanonicalId: null,
      reason: "Operator confirmed these fixtures describe distinct units."
    });
    const created = CreateDuplicateOverrideResponseSchema.parse(await response.json());

    expect(response.status).toBe(202);
    expect(created.override.kind).toBe("force_split");
    expect(created.decisionJob).toMatchObject({
      status: "queued",
      targetCorpusRevision: 2
    });

    const historyResponse = await getOverrides();
    const history = DuplicateOverrideHistoryResponseSchema.parse(await historyResponse.json());
    expect(history.overrides).toEqual([created.override]);
    expect(history.activeOverrideIds).toEqual([created.override.id]);

    const jobResponse = await getDecisionJob(new Request("http://127.0.0.1"), {
      params: Promise.resolve({ id: created.decisionJob.id })
    });
    const job = DecisionJobSummarySchema.parse(await jobResponse.json());
    expect(jobResponse.status).toBe(200);
    expect(job).toEqual(created.decisionJob);

    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    try {
      const events = createSqliteRepositories(connection).activityEvents.list();
      const event = events.find((candidate) => candidate.targetId === created.override.id);
      expect(event).toMatchObject({
        action: "duplicate.override_created",
        targetType: "duplicate_override",
        outcome: "succeeded"
      });
      expect(JSON.stringify(event?.metadata)).not.toContain(created.override.reason);
    } finally {
      connection.close();
    }
  });

  it("rejects malformed and unknown override references without bumping the corpus", async () => {
    const malformedResponse = await postOverride({
      kind: "force_split",
      sourceRecordIds: ["src-juniper-zillow"],
      survivorCanonicalId: null,
      reason: null
    });
    expect(malformedResponse.status).toBe(400);
    expect(DecisionApiErrorResponseSchema.parse(await malformedResponse.json()).code).toBe(
      "malformed_request"
    );

    const unknownResponse = await postOverride({
      kind: "force_split",
      sourceRecordIds: ["src-juniper-zillow", "src-not-present"],
      survivorCanonicalId: null,
      reason: null
    });
    expect(unknownResponse.status).toBe(409);
    expect(DecisionApiErrorResponseSchema.parse(await unknownResponse.json()).code).toBe(
      "invalid_override_reference"
    );

    const connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
    try {
      const repositories = createSqliteRepositories(connection);
      expect(repositories.decisionJobs.list()).toHaveLength(1);
      expect(repositories.duplicateOverrides.list("profile-demo-primary")).toEqual([]);
    } finally {
      connection.close();
    }
  });

  it("returns a schema-valid not-found response for unknown jobs", async () => {
    const response = await getDecisionJob(new Request("http://127.0.0.1"), {
      params: Promise.resolve({ id: "job-does-not-exist" })
    });
    const body = DecisionApiErrorResponseSchema.parse(await response.json());
    expect(response.status).toBe(404);
    expect(body).toEqual({
      code: "not_found",
      message: "Decision job not found.",
      retryable: false
    });
  });
});
