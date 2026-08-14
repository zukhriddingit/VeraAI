import { expect, it } from "vitest";

import { approvedBrowserConnectorLink } from "./browser-connector-release.ts";

it("fails closed before the private Store item is published", () => {
  expect(
    approvedBrowserConnectorLink({ VERA_CHROME_STORE_RELEASE_STATUS: "reviewing" })
  ).toBeNull();
});
