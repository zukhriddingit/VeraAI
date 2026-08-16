import { describe, expect, it } from "vitest";

import {
  PRIVACY_OWNER_TABLE_POLICY,
  assertPrivacyExportDataSafe,
  privacyExportTableNames,
  privacyOwnerTableNames
} from "./privacy-owner-table-policy.ts";

describe("privacy owner-table policy", () => {
  it("keeps every owner table in a closed, sorted registry", () => {
    expect(privacyOwnerTableNames).toEqual([...privacyOwnerTableNames].sort());
    expect(PRIVACY_OWNER_TABLE_POLICY.accounts).toBe("delete_only");
    expect(PRIVACY_OWNER_TABLE_POLICY.integration_connections).toBe("project");
    expect(PRIVACY_OWNER_TABLE_POLICY.raw_listings).toBe("export");
    expect(privacyExportTableNames).not.toContain("sessions");
    expect(privacyExportTableNames).not.toContain("browser_connector_enrollment_tickets");
  });

  it("rejects secret-bearing keys recursively", () => {
    expect(() =>
      assertPrivacyExportDataSafe({ safe: { credentialCiphertext: "must-not-export" } })
    ).toThrow("credentialCiphertext");
    expect(() => assertPrivacyExportDataSafe({ rows: [{ sessionToken: "secret" }] })).toThrow(
      "sessionToken"
    );
    expect(() => assertPrivacyExportDataSafe({ relayCredentialDigest: "a".repeat(64) })).toThrow(
      "relayCredentialDigest"
    );
    expect(() =>
      assertPrivacyExportDataSafe({ sourceUrl: "https://example.test/listing", observedAt: null })
    ).not.toThrow();
  });
});
