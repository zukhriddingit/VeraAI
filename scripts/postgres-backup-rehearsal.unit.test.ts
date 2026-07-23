import { describe, expect, it } from "vitest";

import {
  redactedDatabaseLabel,
  validateBackupRehearsalTarget
} from "./postgres-backup-rehearsal.ts";

describe("PostgreSQL backup rehearsal safety", () => {
  it.each([
    ["postgresql://vera:secret@db.example.test/production", "vera_test"],
    ["postgresql://vera:secret@127.0.0.1:5432/vera_test", "wrong-confirmation"]
  ])("rejects an unsafe rehearsal target", (url, confirmation) => {
    expect(() => validateBackupRehearsalTarget(url, confirmation)).toThrow(
      "Backup rehearsal requires the exact vera_test database and confirmation."
    );
  });

  it("returns a credential-free diagnostic label", () => {
    expect(redactedDatabaseLabel("postgresql://vera:secret@127.0.0.1:5432/vera_test")).toBe(
      "127.0.0.1:5432/vera_test"
    );
  });
});
