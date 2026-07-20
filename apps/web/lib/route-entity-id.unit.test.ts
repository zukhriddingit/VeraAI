import { describe, expect, it } from "vitest";

import { parseRouteEntityId } from "./route-entity-id.ts";

describe("route entity IDs", () => {
  it("accepts plain and percent-encoded canonical IDs", () => {
    expect(parseRouteEntityId("canonical:abc123")).toBe("canonical:abc123");
    expect(parseRouteEntityId("canonical%3Aabc123")).toBe("canonical:abc123");
  });

  it("fails closed for malformed escapes and decoded path separators", () => {
    expect(parseRouteEntityId("canonical%ZZabc123")).toBeNull();
    expect(parseRouteEntityId("canonical%2Fabc123")).toBeNull();
  });
});
