import { describe, expect, it } from "vitest";

import { parsePrivacyEnvironment } from "./privacy-config.ts";

describe("privacy environment", () => {
  it("accepts only a protected HMAC key and bounded backup retention", () => {
    expect(
      parsePrivacyEnvironment({
        VERA_PRIVACY_SUBJECT_HMAC_KEY: "k".repeat(32),
        VERA_PRIVACY_BACKUP_RETENTION_DAYS: "30"
      })
    ).toEqual({ subjectHmacKey: "k".repeat(32), backupRetentionDays: 30 });
    expect(() => parsePrivacyEnvironment({ VERA_PRIVACY_BACKUP_RETENTION_DAYS: "30" })).toThrow(
      "HMAC"
    );
    expect(() =>
      parsePrivacyEnvironment({
        VERA_PRIVACY_SUBJECT_HMAC_KEY: "short",
        VERA_PRIVACY_BACKUP_RETENTION_DAYS: "30"
      })
    ).toThrow("32");
    for (const retention of ["", "0", "366", "30.5", "not-a-number"]) {
      expect(() =>
        parsePrivacyEnvironment({
          VERA_PRIVACY_SUBJECT_HMAC_KEY: "k".repeat(32),
          VERA_PRIVACY_BACKUP_RETENTION_DAYS: retention
        })
      ).toThrow("1 through 365");
    }
  });
});
