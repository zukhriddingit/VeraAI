import { describe, expect, it } from "vitest";

import { VERA_BETA_URL, VERA_DEMO_URL, VERA_SIGN_IN_URL } from "./urls.ts";

describe("marketing launch links", () => {
  it("targets the canonical Heroku product domain", () => {
    expect(VERA_DEMO_URL).toBe("https://app.verahousing.app/demo");
    expect(VERA_BETA_URL).toBe("https://app.verahousing.app/beta");
    expect(VERA_SIGN_IN_URL).toBe("https://app.verahousing.app/sign-in");
  });
});
