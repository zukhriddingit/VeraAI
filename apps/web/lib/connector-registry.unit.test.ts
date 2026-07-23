import { describe, expect, it } from "vitest";

import { listSourceConnectors } from "./connector-registry.ts";

describe("connector composition roots", () => {
  it("keeps synthetic fixtures out of the hosted connector registry", () => {
    expect(listSourceConnectors("hosted").map((connector) => connector.connectorId)).toEqual([
      "manual.capture.v1"
    ]);
  });

  it("retains fixtures only in the explicit deterministic demo registry", () => {
    expect(listSourceConnectors("demo").map((connector) => connector.connectorId)).toEqual([
      "fixture.feed.v1",
      "manual.capture.v1"
    ]);
  });
});
