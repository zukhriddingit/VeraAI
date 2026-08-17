import type { PrivacyDeletionReceipt } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import {
  reapplyPrivacyDeletions,
  type ReapplyPrivacyDeletionDependencies
} from "./reapply-privacy-deletions.ts";

const databaseUrl = "postgresql://operator:private-value@database.example.test/vera_restore";
const arguments_ = [
  "--confirm",
  "vera_restore",
  "--receipt-file",
  "/private/receipts.json"
] as const;

function receipt(input: {
  id: string;
  formerUserId: string;
  completedAt: string;
}): PrivacyDeletionReceipt {
  return {
    id: input.id,
    formerUserId: input.formerUserId as PrivacyDeletionReceipt["formerUserId"],
    subjectDigest: input.id.startsWith("1") ? "a".repeat(64) : "b".repeat(64),
    providerRevocation: "confirmed",
    browserRevocation: "confirmed",
    completedAt: input.completedAt,
    backupEraseAfter: "2026-09-16T12:00:00.000Z",
    legalHoldUntil: null
  };
}

const firstReceipt = receipt({
  id: "10000000-0000-4000-8000-000000000001",
  formerUserId: "30000000-0000-4000-8000-000000000003",
  completedAt: "2026-08-15T12:00:00.000Z"
});
const secondReceipt = receipt({
  id: "20000000-0000-4000-8000-000000000002",
  formerUserId: "40000000-0000-4000-8000-000000000004",
  completedAt: "2026-08-16T12:00:00.000Z"
});

function fixture(contents: unknown) {
  const readReceiptFile = vi.fn(async () =>
    typeof contents === "string" ? contents : JSON.stringify(contents)
  );
  const assertPrivateRegularFile = vi.fn(async () => undefined);
  const reapply = vi.fn(async (value: PrivacyDeletionReceipt) =>
    value.id === firstReceipt.id ? ("absent" as const) : ("reapplied" as const)
  );
  return { readReceiptFile, assertPrivateRegularFile, reapply };
}

describe("privacy deletion restore enforcement", () => {
  it("sorts strict receipts and returns count-only evidence", async () => {
    const dependencies = fixture([secondReceipt, firstReceipt]);
    const result = await reapplyPrivacyDeletions(
      arguments_,
      { DATABASE_URL: databaseUrl },
      dependencies
    );
    expect(result).toEqual({ checked: 2, absent: 1, reapplied: 1, failed: 0 });
    expect(JSON.stringify(result)).toBe('{"checked":2,"absent":1,"reapplied":1,"failed":0}');
    expect(dependencies.reapply.mock.calls.map(([value]) => value.id)).toEqual([
      firstReceipt.id,
      secondReceipt.id
    ]);
    expect(JSON.stringify(result)).not.toMatch(/email|digest|postgres|private-value/iu);
  });

  it.each([
    { label: "missing arguments", argv: [] },
    { label: "missing receipt file", argv: ["--confirm", "vera_restore"] },
    {
      label: "database URL argument",
      argv: ["--database-url", databaseUrl, "--receipt-file", "/private/receipts.json"]
    },
    {
      label: "mismatched confirmation",
      argv: ["--confirm", "wrong", "--receipt-file", "/private/receipts.json"]
    },
    {
      label: "duplicate confirmation",
      argv: ["--confirm", "vera_restore", "--confirm", "vera_restore"]
    }
  ])("rejects $label", async ({ argv }) => {
    await expect(
      reapplyPrivacyDeletions(argv, { DATABASE_URL: databaseUrl }, fixture([]))
    ).rejects.toThrow();
  });

  it("rejects a receipt path that is not a private regular file", async () => {
    const base = fixture([]);
    const dependencies: ReapplyPrivacyDeletionDependencies = {
      ...base,
      assertPrivateRegularFile: vi.fn(async () => {
        throw new Error("mode is not 0600");
      })
    };
    await expect(
      reapplyPrivacyDeletions(arguments_, { DATABASE_URL: databaseUrl }, dependencies)
    ).rejects.toThrow();
    expect(base.readReceiptFile).not.toHaveBeenCalled();
  });

  it.each([
    { label: "malformed JSON", contents: "{" },
    { label: "non-array JSON", contents: { receipt: firstReceipt } },
    {
      label: "duplicate receipt IDs",
      contents: [firstReceipt, { ...secondReceipt, id: firstReceipt.id }]
    },
    {
      label: "duplicate former owners",
      contents: [firstReceipt, { ...secondReceipt, formerUserId: firstReceipt.formerUserId }]
    },
    {
      label: "identity-bearing receipts",
      contents: [{ ...firstReceipt, email: "owner@example.test" }]
    }
  ])("rejects $label", async ({ contents }) => {
    await expect(
      reapplyPrivacyDeletions(arguments_, { DATABASE_URL: databaseUrl }, fixture(contents))
    ).rejects.toThrow();
  });

  it("stops after a failed receipt and returns a nonzero failure count", async () => {
    const base = fixture([firstReceipt, secondReceipt]);
    const reapply = vi.fn(async (_receipt: PrivacyDeletionReceipt) => {
      throw new Error("database unavailable");
    });
    const dependencies: ReapplyPrivacyDeletionDependencies = { ...base, reapply };
    await expect(
      reapplyPrivacyDeletions(arguments_, { DATABASE_URL: databaseUrl }, dependencies)
    ).resolves.toEqual({ checked: 1, absent: 0, reapplied: 0, failed: 1 });
    expect(reapply).toHaveBeenCalledTimes(1);
  });
});
