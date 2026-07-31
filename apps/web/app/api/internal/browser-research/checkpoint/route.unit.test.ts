import { describe, expect, it } from "vitest";

import {
  assertCheckpointRequestOrigin,
  CheckpointAuthorizationError,
  requireCheckpointBearer,
  validCheckpointBearer
} from "./route.ts";
import { CrossOriginMutationError } from "../../../../../lib/server/request-security.ts";

describe("validCheckpointBearer", () => {
  it("accepts only an exact bearer credential", () => {
    const expected = "a".repeat(32);
    expect(validCheckpointBearer(`Bearer ${expected}`, expected)).toBe(true);
    expect(validCheckpointBearer(`Bearer ${"b".repeat(32)}`, expected)).toBe(false);
    expect(validCheckpointBearer(`Bearer ${"a".repeat(31)}`, expected)).toBe(false);
    expect(validCheckpointBearer(null, expected)).toBe(false);
  });

  it("throws before request processing when the credential is absent or wrong", () => {
    const expected = "a".repeat(32);
    expect(() => requireCheckpointBearer(`Bearer ${expected}`, expected)).not.toThrow();
    expect(() => requireCheckpointBearer(`Bearer ${"b".repeat(32)}`, expected)).toThrow(
      CheckpointAuthorizationError
    );
    expect(() => requireCheckpointBearer(null, expected)).toThrow(CheckpointAuthorizationError);
  });

  it("accepts only the exact HTTPS origin of the bearer-authenticated checkpoint request", () => {
    expect(() =>
      assertCheckpointRequestOrigin(
        new Request("https://vera-api.example.test/api/internal/browser-research/checkpoint", {
          headers: { origin: "https://vera-api.example.test" }
        })
      )
    ).not.toThrow();
    for (const origin of [
      null,
      "https://app.example.test",
      "https://vera-api.example.test/path",
      "https://user@vera-api.example.test"
    ]) {
      expect(() =>
        assertCheckpointRequestOrigin(
          new Request("https://vera-api.example.test/api/internal/browser-research/checkpoint", {
            ...(origin === null ? {} : { headers: { origin } })
          })
        )
      ).toThrow(CrossOriginMutationError);
    }
  });
});
