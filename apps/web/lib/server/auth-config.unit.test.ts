import { describe, expect, it } from "vitest";

import { buildIdentityAuthOptions, parseIdentityAuthEnvironment } from "./auth-config.ts";

const environment = {
  BETTER_AUTH_SECRET: "synthetic-test-secret-with-more-than-32-characters",
  VERA_PUBLIC_BASE_URL: "https://vera.example.test",
  VERA_AUTH_GOOGLE_CLIENT_ID: "synthetic-login-client-id",
  VERA_AUTH_GOOGLE_CLIENT_SECRET: "synthetic-login-client-secret",
  NODE_ENV: "production"
} as const;

describe("hosted identity configuration", () => {
  it("requests identity scopes only and hardens token/state handling", () => {
    const options = buildIdentityAuthOptions(parseIdentityAuthEnvironment(environment));

    expect(options.socialProviders.google.scope).toEqual(["openid", "email", "profile"]);
    expect(options.socialProviders.google).not.toHaveProperty("accessType");
    expect(options.socialProviders.google).not.toHaveProperty("prompt");
    expect(options.socialProviders.google.disableIdTokenSignIn).toBe(true);
    expect(options.account.encryptOAuthTokens).toBe(true);
    expect(options.account.storeStateStrategy).toBe("database");
    expect(options.account.accountLinking.allowDifferentEmails).toBe(false);
    expect(options.advanced.database.generateId).toBe("uuid");
    expect(options.advanced.useSecureCookies).toBe(true);

    const serialized = JSON.stringify(options);
    expect(serialized).not.toMatch(/gmail|calendar|mail\.google\.com/iu);
    expect(serialized).not.toContain("offline");
  });

  it("rejects non-HTTPS hosted origins and short secrets", () => {
    expect(() =>
      parseIdentityAuthEnvironment({ ...environment, VERA_PUBLIC_BASE_URL: "http://vera.test" })
    ).toThrow(/HTTPS/u);
    expect(() =>
      parseIdentityAuthEnvironment({ ...environment, BETTER_AUTH_SECRET: "too-short" })
    ).toThrow(/32/u);
    expect(
      parseIdentityAuthEnvironment({
        ...environment,
        VERA_PUBLIC_BASE_URL: "http://127.0.0.1:3000"
      }).VERA_PUBLIC_BASE_URL
    ).toBe("http://127.0.0.1:3000");
  });
});
