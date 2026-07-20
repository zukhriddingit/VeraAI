import { describe, expect, it } from "vitest";

import type { DuplicateOverride } from "@vera/domain";

import { assertOverrideReferences, resolveActiveOverrides } from "./overrides.ts";

const now = "2026-07-20T18:00:00.000Z";

function override(
  id: string,
  kind: DuplicateOverride["kind"],
  createdAt: string
): DuplicateOverride {
  return {
    id,
    searchProfileId: "profile-primary",
    kind,
    sourceRecordIds: ["source-a", "source-b"],
    survivorCanonicalId: kind === "force_merge" ? "canonical-a" : null,
    reason: "Sanitized review decision.",
    createdBy: "user",
    createdAt
  };
}

describe("duplicate override resolution", () => {
  it("uses the newest active decision for the same source set", () => {
    const older = override("override-older", "force_merge", now);
    const newer = override("override-newer", "force_split", "2026-07-20T19:00:00.000Z");
    expect(resolveActiveOverrides([newer, older])).toEqual([newer]);
  });

  it("keeps revoked overrides historical but inactive", () => {
    const value = override("override-a", "force_merge", now);
    expect(
      resolveActiveOverrides(
        [value],
        [
          {
            id: "revocation-a",
            overrideId: value.id,
            reason: "Superseded by user review.",
            createdBy: "user",
            createdAt: "2026-07-20T20:00:00.000Z"
          }
        ]
      )
    ).toEqual([]);
  });

  it("fails visibly for stale source or survivor references", () => {
    const value = override("override-a", "force_merge", now);
    expect(() => assertOverrideReferences([value], new Set(["source-a"]), new Set())).toThrow(
      /unknown source/iu
    );
    expect(() =>
      assertOverrideReferences(
        [value],
        new Set(["source-a", "source-b"]),
        new Set(["canonical-other"])
      )
    ).toThrow(/unknown survivor/iu);
  });
});
