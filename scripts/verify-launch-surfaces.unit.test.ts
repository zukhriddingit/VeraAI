import { describe, expect, it } from "vitest";

import { findLaunchSurfaceViolations } from "./verify-launch-surfaces.ts";

const clean = {
  marketing: "href={VERA_DEMO_URL} href={VERA_BETA_URL} href={VERA_SIGN_IN_URL}",
  demoPage: `export const dynamic = "force-static"; import { PublicDemo } from "./public-demo.tsx";`,
  demoClient: `"use client"; useState();`,
  demoFixtures: "https://example.invalid/demo/listing",
  allLaunchText: "https://app.verahousing.app/demo"
};

describe("launch surface boundary", () => {
  it("accepts the static split", () => {
    expect(findLaunchSurfaceViolations(clean)).toEqual([]);
  });

  it("rejects Railway", () => {
    expect(
      findLaunchSurfaceViolations({
        ...clean,
        allLaunchText: "https://vera-production-f19c.up.railway.app/"
      })
    ).toContain("Obsolete Railway URL is forbidden.");
  });

  it("rejects repository imports in the demo", () => {
    expect(
      findLaunchSurfaceViolations({ ...clean, demoPage: `import { x } from "@vera/db"` })
    ).toContain("Public demo must not import application or persistence code.");
  });

  it("rejects API requests in the demo client", () => {
    expect(
      findLaunchSurfaceViolations({ ...clean, demoClient: `fetch("/api/listings")` })
    ).toContain("Public demo must not call an API.");
  });

  it("rejects live domains in demo fixtures", () => {
    expect(
      findLaunchSurfaceViolations({ ...clean, demoFixtures: "https://www.zillow.com/example" })
    ).toContain("Public demo fixtures must not retain live marketplace domains.");
  });
});
