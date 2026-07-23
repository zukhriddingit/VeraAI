import { describe, expect, it } from "vitest";

import { parseGoogleIntegrationEnvironment } from "./integration-config.ts";

const key = Buffer.alloc(32, 7).toString("base64");
const complete = {
  NODE_ENV: "development",
  VERA_PUBLIC_BASE_URL: "http://127.0.0.1:3000",
  VERA_GOOGLE_INTEGRATION_CLIENT_ID: "integration-client.apps.example.test",
  VERA_GOOGLE_INTEGRATION_CLIENT_SECRET: "synthetic-client-secret",
  VERA_GOOGLE_INTEGRATION_REDIRECT_URI:
    "http://127.0.0.1:3000/api/integrations/google/calendar/callback",
  VERA_GOOGLE_TIMEOUT_MS: "5000",
  VERA_CREDENTIAL_KEY_ID: "test-key",
  VERA_CREDENTIAL_KEYS_JSON: JSON.stringify({ "test-key": key })
};

describe("Google integration environment", () => {
  it("is explicitly unconfigured when every integration client value is absent", () => {
    expect(parseGoogleIntegrationEnvironment({})).toBeNull();
    expect(
      parseGoogleIntegrationEnvironment({
        VERA_GOOGLE_INTEGRATION_CLIENT_ID: "",
        VERA_GOOGLE_INTEGRATION_CLIENT_SECRET: "   ",
        VERA_GOOGLE_INTEGRATION_REDIRECT_URI: ""
      })
    ).toBeNull();
  });

  it("rejects partial client configuration", () => {
    expect(() =>
      parseGoogleIntegrationEnvironment({
        VERA_GOOGLE_INTEGRATION_CLIENT_ID: complete.VERA_GOOGLE_INTEGRATION_CLIENT_ID
      })
    ).toThrow("configured together");
  });

  it("parses a separate web-app client and bounded timeout", async () => {
    const value = parseGoogleIntegrationEnvironment(complete);
    expect(value).toMatchObject({
      clientId: complete.VERA_GOOGLE_INTEGRATION_CLIENT_ID,
      redirectUri: complete.VERA_GOOGLE_INTEGRATION_REDIRECT_URI,
      publicBaseUrl: complete.VERA_PUBLIC_BASE_URL,
      oauthStateTtlMilliseconds: 600_000,
      providerTimeoutMilliseconds: 5_000
    });
    await expect(value?.credentialKeyProvider.current()).resolves.toMatchObject({
      keyId: "test-key"
    });
  });

  it("requires exact callback matching and HTTPS in production", () => {
    expect(() =>
      parseGoogleIntegrationEnvironment({
        ...complete,
        VERA_GOOGLE_INTEGRATION_REDIRECT_URI:
          "http://127.0.0.1:3000/api/integrations/google/calendar/callback?extra=1"
      })
    ).toThrow("exactly equal");

    expect(() =>
      parseGoogleIntegrationEnvironment({ ...complete, NODE_ENV: "production" })
    ).toThrow("HTTPS");
  });

  it.each(["999", "20001"])("rejects an out-of-range timeout of %s ms", (timeout) => {
    expect(() =>
      parseGoogleIntegrationEnvironment({ ...complete, VERA_GOOGLE_TIMEOUT_MS: timeout })
    ).toThrow();
  });

  it("rejects malformed or non-32-byte credential keys", () => {
    expect(() =>
      parseGoogleIntegrationEnvironment({
        ...complete,
        VERA_CREDENTIAL_KEYS_JSON: JSON.stringify({
          "test-key": Buffer.alloc(31).toString("base64")
        })
      })
    ).toThrow("exactly 32 bytes");
  });
});
