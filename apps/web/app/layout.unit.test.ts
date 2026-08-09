import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RootLayout", () => {
  it("tolerates inert root attributes injected by browser extensions before hydration", () => {
    const source = readFileSync(new URL("layout.tsx", import.meta.url), "utf8");

    expect(source).toContain("<body suppressHydrationWarning>");
  });
});
