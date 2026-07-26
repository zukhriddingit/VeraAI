import { describe, expect, it } from "vitest";

import {
  MinimizedRemoteExtensionSnapshotSchema,
  RemoteExtensionSnapshotConfirmationSchema
} from "./remote-extension-snapshot.ts";

function validSnapshot() {
  return {
    schemaVersion: "1",
    capturedAt: "2026-07-25T20:00:00.000Z",
    page: { url: "https://example.test/", title: "Shared listing" },
    textLines: ['- heading "Shared listing"'],
    sourceLineCount: 4,
    returnedLineCount: 1,
    sourceTruncated: false,
    sourceSha256: "a".repeat(64),
    contentSha256: "b".repeat(64)
  };
}

describe("remote extension snapshot contracts", () => {
  it("requires explicit consent for exactly one read-only shared tab", () => {
    expect(() =>
      RemoteExtensionSnapshotConfirmationSchema.parse({
        sharedExactlyOneTab: true,
        approvesReadOnlySnapshot: true,
        understandsNoBrowserInteraction: true,
        understandsConnectivitySpikeOnly: true
      })
    ).not.toThrow();
    expect(() =>
      RemoteExtensionSnapshotConfirmationSchema.parse({
        sharedExactlyOneTab: false,
        approvesReadOnlySnapshot: true,
        understandsNoBrowserInteraction: true,
        understandsConnectivitySpikeOnly: true
      })
    ).toThrow();
  });

  it("accepts a closed minimized snapshot", () => {
    expect(MinimizedRemoteExtensionSnapshotSchema.parse(validSnapshot())).toEqual(validSnapshot());
  });

  it.each([
    ["query URL", { page: { url: "https://example.test/a?token=hidden", title: "A" } }],
    ["path URL", { page: { url: "https://example.test/private-id", title: "A" } }],
    ["raw target", { textLines: ["heading [target=raw-id]"] }],
    ["email", { textLines: ["Contact founder@example.test"] }],
    ["phone", { textLines: ["Call 617-555-0101"] }],
    ["profile path", { textLines: ["/Users/founder/Chrome/Profile 1"] }],
    ["extra field", { rawSnapshot: "not allowed" }]
  ])("rejects %s in a minimized response", (_label, patch) => {
    expect(() =>
      MinimizedRemoteExtensionSnapshotSchema.parse({ ...validSnapshot(), ...patch })
    ).toThrow();
  });

  it("rejects line-count and total-text mismatches", () => {
    expect(() =>
      MinimizedRemoteExtensionSnapshotSchema.parse({
        ...validSnapshot(),
        returnedLineCount: 2
      })
    ).toThrow();
    expect(() =>
      MinimizedRemoteExtensionSnapshotSchema.parse({
        ...validSnapshot(),
        textLines: Array.from({ length: 14 }, () => "x".repeat(180)),
        returnedLineCount: 14
      })
    ).toThrow();
  });
});
