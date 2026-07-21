import type { BetterAuthOptions } from "better-auth";

export interface IdentityAuthEnvironment {
  readonly BETTER_AUTH_SECRET: string;
  readonly VERA_PUBLIC_BASE_URL: string;
  readonly VERA_AUTH_GOOGLE_CLIENT_ID: string;
  readonly VERA_AUTH_GOOGLE_CLIENT_SECRET: string;
  readonly NODE_ENV: string;
}

function required(
  environment: Readonly<Record<string, string | undefined>>,
  name: keyof IdentityAuthEnvironment
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for hosted Vera identity.`);
  return value;
}

export function parseIdentityAuthEnvironment(
  environment: Readonly<Record<string, string | undefined>>
): IdentityAuthEnvironment {
  const secret = required(environment, "BETTER_AUTH_SECRET");
  if (secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  const baseURL = required(environment, "VERA_PUBLIC_BASE_URL");
  const url = new URL(baseURL);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("VERA_PUBLIC_BASE_URL must use HTTPS outside loopback development.");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("VERA_PUBLIC_BASE_URL must be an exact origin without path or credentials.");
  }
  return {
    BETTER_AUTH_SECRET: secret,
    VERA_PUBLIC_BASE_URL: url.origin,
    VERA_AUTH_GOOGLE_CLIENT_ID: required(environment, "VERA_AUTH_GOOGLE_CLIENT_ID"),
    VERA_AUTH_GOOGLE_CLIENT_SECRET: required(environment, "VERA_AUTH_GOOGLE_CLIENT_SECRET"),
    NODE_ENV: environment.NODE_ENV ?? "development"
  };
}

export function buildIdentityAuthOptions(environment: IdentityAuthEnvironment) {
  return {
    appName: "Vera",
    baseURL: environment.VERA_PUBLIC_BASE_URL,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: [environment.VERA_PUBLIC_BASE_URL],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: environment.VERA_AUTH_GOOGLE_CLIENT_ID,
        clientSecret: environment.VERA_AUTH_GOOGLE_CLIENT_SECRET,
        scope: ["openid", "email", "profile"],
        disableIdTokenSignIn: true
      }
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        trustedProviders: ["google"]
      }
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: environment.NODE_ENV === "production",
      disableCSRFCheck: false,
      disableOriginCheck: false,
      crossSubDomainCookies: { enabled: false },
      cookiePrefix: "vera"
    }
  } satisfies BetterAuthOptions;
}
