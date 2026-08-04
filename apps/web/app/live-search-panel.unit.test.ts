import { describe, expect, it } from "vitest";

import { STATIC_ACCEPTANCE_SNAPSHOT_WARNING } from "./static-acceptance-warning.ts";

describe("LiveSearchPanel acceptance snapshot warning", () => {
  it("uses the exact required developer warning", () => {
    expect(STATIC_ACCEPTANCE_SNAPSHOT_WARNING).toBe(
      "Static acceptance snapshot — controls are not interactive."
    );
  });
});
