import { describe, expect, it } from "vitest";

import {
  POSTGRES_DECISION_INSERT_BATCH_SIZE,
  chunkForPostgresInsert
} from "./decision-reconciliation.ts";

describe("PostgreSQL decision reconciliation batching", () => {
  it("keeps large immutable pair-audit inserts inside a bounded statement size", () => {
    const values = Array.from(
      { length: POSTGRES_DECISION_INSERT_BATCH_SIZE * 2 + 17 },
      (_, index) => index
    );

    const chunks = chunkForPostgresInsert(values);

    expect(chunks.map((chunk) => chunk.length)).toEqual([
      POSTGRES_DECISION_INSERT_BATCH_SIZE,
      POSTGRES_DECISION_INSERT_BATCH_SIZE,
      17
    ]);
    expect(chunks.flat()).toEqual(values);
  });

  it("does not create an empty insert batch", () => {
    expect(chunkForPostgresInsert([])).toEqual([]);
  });
});
