import { StaticCredentialKeyProvider, type CredentialKeyProvider } from "@vera/db";
import { z } from "zod";

const DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS = 10_000;
const OAUTH_STATE_TTL_MILLISECONDS = 600_000 as const;
const GOOGLE_CALLBACK_PATH = "/api/integrations/google/calendar/callback";
const GOOGLE_GMAIL_CALLBACK_PATH = "/api/integrations/google/gmail/callback";

const OptionalEnvironmentValueSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);
const TimeoutSchema = z.coerce.number().int().min(1_000).max(20_000);
const KeyIdSchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/u);
const Base64KeySchema = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);

export interface GoogleIntegrationEnvironment {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly gmailRedirectUri: string;
  readonly publicBaseUrl: string;
  readonly oauthStateTtlMilliseconds: 600_000;
  readonly providerTimeoutMilliseconds: number;
  readonly credentialKeyProvider: CredentialKeyProvider;
}

function exactOrigin(value: string, name: string, production: boolean): string {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && !production)) {
    throw new Error(`${name} must use HTTPS outside loopback development.`);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be an exact origin without a path or credentials.`);
  }
  return url.origin;
}

function parseKeyProvider(
  keyIdInput: string | undefined,
  keysInput: string | undefined
): CredentialKeyProvider {
  const keyId = KeyIdSchema.parse(keyIdInput);
  if (!keysInput) throw new Error("VERA_CREDENTIAL_KEYS_JSON is required for Google integration.");

  let decoded: unknown;
  try {
    decoded = JSON.parse(keysInput) as unknown;
  } catch {
    throw new Error("VERA_CREDENTIAL_KEYS_JSON must be a JSON object of base64 keys.");
  }

  const record = z.record(KeyIdSchema, Base64KeySchema).parse(decoded);
  const keys = new Map<string, Uint8Array>();
  for (const [candidateId, encoded] of Object.entries(record)) {
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== 32) {
      throw new Error(`Credential key ${candidateId} must decode to exactly 32 bytes.`);
    }
    keys.set(candidateId, key);
  }
  return new StaticCredentialKeyProvider(keyId, keys);
}

export function parseGoogleIntegrationEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): GoogleIntegrationEnvironment | null {
  const clientId = OptionalEnvironmentValueSchema.parse(
    environment.VERA_GOOGLE_INTEGRATION_CLIENT_ID
  );
  const clientSecret = OptionalEnvironmentValueSchema.parse(
    environment.VERA_GOOGLE_INTEGRATION_CLIENT_SECRET
  );
  const redirectUriInput = OptionalEnvironmentValueSchema.parse(
    environment.VERA_GOOGLE_INTEGRATION_REDIRECT_URI
  );
  const configuredValues = [clientId, clientSecret, redirectUriInput].filter(
    (value) => value !== undefined
  );

  if (configuredValues.length === 0) return null;
  if (configuredValues.length !== 3) {
    throw new Error(
      "Google integration client ID, client secret, and redirect URI must be configured together."
    );
  }

  const production = environment.NODE_ENV === "production";
  const publicBaseUrl = exactOrigin(
    z.string().trim().min(1).parse(environment.VERA_PUBLIC_BASE_URL),
    "VERA_PUBLIC_BASE_URL",
    production
  );
  const redirectUri = new URL(z.string().url().parse(redirectUriInput));
  const expectedRedirectUri = `${publicBaseUrl}${GOOGLE_CALLBACK_PATH}`;
  if (redirectUri.href !== expectedRedirectUri) {
    throw new Error(
      `VERA_GOOGLE_INTEGRATION_REDIRECT_URI must exactly equal ${expectedRedirectUri}.`
    );
  }
  if (redirectUri.protocol !== "https:" && production) {
    throw new Error("VERA_GOOGLE_INTEGRATION_REDIRECT_URI must use HTTPS in production.");
  }

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    redirectUri: redirectUri.href,
    gmailRedirectUri: `${publicBaseUrl}${GOOGLE_GMAIL_CALLBACK_PATH}`,
    publicBaseUrl,
    oauthStateTtlMilliseconds: OAUTH_STATE_TTL_MILLISECONDS,
    providerTimeoutMilliseconds: TimeoutSchema.parse(
      environment.VERA_GOOGLE_TIMEOUT_MS ?? DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS
    ),
    credentialKeyProvider: parseKeyProvider(
      environment.VERA_CREDENTIAL_KEY_ID,
      environment.VERA_CREDENTIAL_KEYS_JSON
    )
  };
}
