import type { CalendarCapability, IntegrationConnection, VeraUserId } from "@vera/domain";
import type { UserRepositoryProvider } from "@vera/db";

import type { GoogleIntegrationEnvironment } from "./integration-config.ts";

export type GoogleIntegrationOAuthErrorCode =
  | "invalid_state"
  | "invalid_callback"
  | "account_linking_conflict"
  | "scope_not_granted"
  | "google_disconnected"
  | "integration_refresh_in_progress"
  | "reconnect_required"
  | "provider_unavailable"
  | "provider_revocation_unconfirmed"
  | "provider_denied";

export class GoogleIntegrationOAuthError extends Error {
  readonly code: GoogleIntegrationOAuthErrorCode;
  readonly httpStatus: number;

  constructor(code: GoogleIntegrationOAuthErrorCode, httpStatus: number) {
    super(`Google integration authorization failed: ${code}.`);
    this.name = "GoogleIntegrationOAuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type GoogleOAuthProviderErrorCode =
  "invalid_grant" | "access_denied" | "invalid_response" | "transient_failure" | "timeout";

export class GoogleOAuthProviderError extends Error {
  readonly code: GoogleOAuthProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: GoogleOAuthProviderErrorCode, retryable: boolean) {
    super(`Google OAuth provider operation failed: ${code}.`);
    this.name = "GoogleOAuthProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface GoogleOAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string;
  readonly expiresAt: string | null;
}

export interface VerifiedGoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

export interface VerifiedGoogleTokenInfo {
  readonly audience: string;
  readonly subject: string | null;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
}

export interface RefreshedGoogleAccessToken {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
}

export interface GoogleOAuthTransport {
  createAuthorizationUrl(input: {
    readonly state: string;
    readonly scopes: readonly string[];
    readonly codeChallenge: string;
    readonly prompt: "consent" | null;
  }): string;
  exchangeCode(input: {
    readonly code: string;
    readonly codeVerifier: string;
  }): Promise<GoogleOAuthTokenSet>;
  verifyIdentity(idToken: string): Promise<VerifiedGoogleIdentity>;
  inspectAccessToken(accessToken: string): Promise<VerifiedGoogleTokenInfo>;
  refreshAccessToken(refreshToken: string): Promise<RefreshedGoogleAccessToken>;
  revokeToken(refreshToken: string): Promise<void>;
}

export interface SafeOAuthLogger {
  info(event: string, metadata: Readonly<Record<string, string | boolean | number | null>>): void;
  warn(event: string, metadata: Readonly<Record<string, string | boolean | number | null>>): void;
}

export interface GoogleIntegrationOAuth {
  createAuthorization(input: {
    readonly userId: VeraUserId;
    readonly capability: CalendarCapability;
    readonly returnTo: string;
  }): Promise<{ readonly authorizationUrl: string }>;
  handleCallback(input: {
    readonly userId: VeraUserId;
    readonly state: string;
    readonly code: string;
  }): Promise<IntegrationConnection>;
  handleDeniedCallback(input: {
    readonly userId: VeraUserId;
    readonly state: string;
  }): Promise<void>;
  refreshAccessToken(input: {
    readonly userId: VeraUserId;
    readonly requiredScope: string;
    readonly signal?: AbortSignal;
  }): Promise<string>;
  disconnect(input: { readonly userId: VeraUserId }): Promise<void>;
}

export interface GoogleIntegrationOAuthDependencies {
  readonly configuration: GoogleIntegrationEnvironment;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly transport?: GoogleOAuthTransport;
  readonly clock?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
  readonly randomId?: () => string;
  readonly logger?: SafeOAuthLogger;
}
