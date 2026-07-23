import { createHash, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

import {
  CalendarCapabilitySchema,
  CalendarGoogleScopeSchema,
  CalendarOAuthStateSchema,
  ActivityEventSchema,
  IntegrationConnectionSchema,
  IntegrationIdSchema,
  SafeReturnToSchema,
  VeraUserIdSchema,
  type CalendarCapability,
  type CalendarGoogleScope,
  type IntegrationConnection,
  type VeraUserId
} from "@vera/domain";
import {
  decryptCredential,
  encryptCredential,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import { CodeChallengeMethod } from "google-auth-library";
import { google } from "googleapis";
import { z } from "zod";

import type { GoogleIntegrationEnvironment } from "./integration-config.ts";

const OPENID_SCOPE = "openid";
const EMAIL_SCOPE = "email";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const RawStateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const AuthorizationCodeSchema = z.string().min(1).max(4_096);
const AccessTokenSchema = z.string().min(1).max(16_384);
const RefreshTokenSchema = z.string().min(1).max(16_384);
const IdTokenSchema = z.string().min(1).max(32_768);
const ProviderSubjectSchema = z.string().min(1).max(255);
const ALLOWED_CALENDAR_SCOPES = new Set<string>([
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned"
]);
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const ALLOWED_GOOGLE_SCOPES = new Set<string>([
  OPENID_SCOPE,
  EMAIL_SCOPE,
  ...ALLOWED_CALENDAR_SCOPES,
  GMAIL_READONLY_SCOPE
]);
const CALENDAR_SCOPE_PREFIX = "https://www.googleapis.com/auth/" + "calendar";
const GMAIL_SCOPE_PREFIX = "https://www.googleapis.com/auth/" + "gmail";
const AllowedRefreshScopeSchema = z.enum([
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned",
  GMAIL_READONLY_SCOPE
]);

const capabilityScopes = {
  calendar_conflict_checking: "https://www.googleapis.com/auth/calendar.freebusy",
  calendar_hold_creation: "https://www.googleapis.com/auth/calendar.events.owned"
} as const satisfies Record<CalendarCapability, CalendarGoogleScope>;

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

const silentLogger: SafeOAuthLogger = {
  info() {},
  warn() {}
};

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function nowIso(clock: () => Date): string {
  return clock().toISOString();
}

function calendarScope(capability: CalendarCapability): CalendarGoogleScope {
  return capabilityScopes[CalendarCapabilitySchema.parse(capability)];
}

function capabilityForScope(scope: CalendarGoogleScope): CalendarCapability {
  return scope === capabilityScopes.calendar_conflict_checking
    ? "calendar_conflict_checking"
    : "calendar_hold_creation";
}

function auditCapabilityForScope(scope: string): string {
  if (scope === GMAIL_READONLY_SCOPE) return "gmail_alert_ingestion";
  return capabilityForScope(CalendarGoogleScopeSchema.parse(scope));
}

function verifiedGrantedScopes(scopes: readonly string[]): string[] {
  const verified = [...new Set(scopes)].sort();
  if (
    verified.some(
      (scope) =>
        (scope.startsWith(CALENDAR_SCOPE_PREFIX) || scope.startsWith(GMAIL_SCOPE_PREFIX)) &&
        !ALLOWED_GOOGLE_SCOPES.has(scope)
    )
  ) {
    throw new GoogleOAuthProviderError("invalid_response", false);
  }
  return verified;
}

function validateAuthorizationUrl(
  value: string,
  input: {
    readonly configuration: GoogleIntegrationEnvironment;
    readonly state: string;
    readonly scope: CalendarGoogleScope;
    readonly codeChallenge: string;
  }
): URL {
  const url = new URL(value);
  const scopes = url.searchParams.get("scope")?.split(" ").sort() ?? [];
  const expectedScopes = [OPENID_SCOPE, EMAIL_SCOPE, input.scope].sort();
  if (
    url.origin !== "https://accounts.google.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.searchParams.get("client_id") !== input.configuration.clientId ||
    url.searchParams.get("redirect_uri") !== input.configuration.redirectUri ||
    url.searchParams.get("response_type") !== "code" ||
    url.searchParams.get("state") !== input.state ||
    url.searchParams.get("code_challenge") !== input.codeChallenge ||
    url.searchParams.get("code_challenge_method") !== "S256" ||
    url.searchParams.get("access_type") !== "offline" ||
    url.searchParams.get("include_granted_scopes") !== "true" ||
    JSON.stringify(scopes) !== JSON.stringify(expectedScopes)
  ) {
    throw new GoogleIntegrationOAuthError("provider_unavailable", 503);
  }
  return url;
}

function onlyGoogleConnection(
  repositories: UserRepositories
): Promise<IntegrationConnection | null> {
  return repositories.integrationConnections.list().then((connections) => {
    const googleConnections = connections.filter((connection) => connection.provider === "google");
    if (googleConnections.length > 1) {
      throw new GoogleIntegrationOAuthError("account_linking_conflict", 409);
    }
    return googleConnections[0] ?? null;
  });
}

function providerFailure(error: unknown): GoogleIntegrationOAuthError {
  if (error instanceof GoogleIntegrationOAuthError) return error;
  if (error instanceof GoogleOAuthProviderError && error.code === "access_denied") {
    return new GoogleIntegrationOAuthError("provider_denied", 403);
  }
  return new GoogleIntegrationOAuthError("provider_unavailable", 503);
}

function withBoundedProviderCall<T>(
  operation: () => Promise<T>,
  timeoutMilliseconds: number,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted === true) {
    return Promise.reject(new GoogleOAuthProviderError("transient_failure", false));
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new GoogleOAuthProviderError("timeout", true)),
      timeoutMilliseconds
    );
    const abort = () => reject(new GoogleOAuthProviderError("transient_failure", false));
    signal?.addEventListener("abort", abort, { once: true });

    operation()
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      });
  });
}

async function retryOneTransient<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!(error instanceof GoogleOAuthProviderError) || !error.retryable) throw error;
    return operation();
  }
}

function googleErrorCode(error: unknown): GoogleOAuthProviderError {
  if (error instanceof GoogleOAuthProviderError) return error;
  if (typeof error !== "object" || error === null) {
    return new GoogleOAuthProviderError("transient_failure", true);
  }
  try {
    const direct = Reflect.get(error, "code");
    const response = Reflect.get(error, "response");
    const data =
      typeof response === "object" && response !== null ? Reflect.get(response, "data") : null;
    const provider = typeof data === "object" && data !== null ? Reflect.get(data, "error") : null;
    const status =
      typeof response === "object" && response !== null
        ? Reflect.get(response, "status")
        : undefined;
    if (direct === "invalid_grant" || provider === "invalid_grant") {
      return new GoogleOAuthProviderError("invalid_grant", false);
    }
    if (direct === "access_denied" || provider === "access_denied") {
      return new GoogleOAuthProviderError("access_denied", false);
    }
    if (status === 429 || (typeof status === "number" && status >= 500)) {
      return new GoogleOAuthProviderError("transient_failure", true);
    }
  } catch {
    return new GoogleOAuthProviderError("transient_failure", true);
  }
  return new GoogleOAuthProviderError("invalid_response", false);
}

function isoFromEpochMilliseconds(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

export function createOfficialGoogleOAuthTransport(
  configuration: GoogleIntegrationEnvironment
): GoogleOAuthTransport {
  const createClient = () =>
    new google.auth.OAuth2({
      clientId: configuration.clientId,
      clientSecret: configuration.clientSecret,
      redirectUri: configuration.redirectUri
    });

  return {
    createAuthorizationUrl(input) {
      return createClient().generateAuthUrl({
        access_type: "offline",
        include_granted_scopes: true,
        scope: [...input.scopes],
        state: input.state,
        code_challenge: input.codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        ...(input.prompt === null ? {} : { prompt: input.prompt })
      });
    },
    async exchangeCode(input) {
      try {
        const result = await createClient().getToken({
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirect_uri: configuration.redirectUri,
          client_id: configuration.clientId
        });
        return {
          accessToken: AccessTokenSchema.parse(result.tokens.access_token),
          refreshToken:
            result.tokens.refresh_token == null
              ? null
              : RefreshTokenSchema.parse(result.tokens.refresh_token),
          idToken: IdTokenSchema.parse(result.tokens.id_token),
          expiresAt: isoFromEpochMilliseconds(result.tokens.expiry_date)
        };
      } catch (error: unknown) {
        throw googleErrorCode(error);
      }
    },
    async verifyIdentity(idToken) {
      try {
        const ticket = await createClient().verifyIdToken({
          idToken: IdTokenSchema.parse(idToken),
          audience: configuration.clientId
        });
        const payload = ticket.getPayload();
        if (
          !payload ||
          !payload.iss ||
          !GOOGLE_ISSUERS.has(payload.iss) ||
          payload.aud !== configuration.clientId
        ) {
          throw new GoogleOAuthProviderError("invalid_response", false);
        }
        return {
          subject: ProviderSubjectSchema.parse(payload.sub),
          email: z.email().max(320).parse(payload.email),
          emailVerified: z.literal(true).parse(payload.email_verified)
        };
      } catch (error: unknown) {
        throw googleErrorCode(error);
      }
    },
    async inspectAccessToken(accessToken) {
      try {
        const info = await createClient().getTokenInfo(AccessTokenSchema.parse(accessToken));
        return {
          audience: z.string().min(1).max(1_000).parse(info.aud),
          subject: info.sub ? ProviderSubjectSchema.parse(info.sub) : null,
          scopes: z.array(z.string().min(1).max(200)).max(32).parse(info.scopes),
          expiresAt: isoFromEpochMilliseconds(info.expiry_date)
        };
      } catch (error: unknown) {
        throw googleErrorCode(error);
      }
    },
    async refreshAccessToken(refreshToken) {
      try {
        const client = createClient();
        client.setCredentials({ refresh_token: RefreshTokenSchema.parse(refreshToken) });
        const result = await client.refreshAccessToken();
        return {
          accessToken: AccessTokenSchema.parse(result.credentials.access_token),
          refreshToken:
            result.credentials.refresh_token == null
              ? null
              : RefreshTokenSchema.parse(result.credentials.refresh_token),
          expiresAt: isoFromEpochMilliseconds(result.credentials.expiry_date)
        };
      } catch (error: unknown) {
        throw googleErrorCode(error);
      }
    },
    async revokeToken(refreshToken) {
      try {
        await createClient().revokeToken(RefreshTokenSchema.parse(refreshToken));
      } catch (error: unknown) {
        throw googleErrorCode(error);
      }
    }
  };
}

export function createGoogleIntegrationOAuth(
  dependencies: GoogleIntegrationOAuthDependencies
): GoogleIntegrationOAuth {
  const configuration = dependencies.configuration;
  const transport = dependencies.transport ?? createOfficialGoogleOAuthTransport(configuration);
  const clock = dependencies.clock ?? (() => new Date());
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const randomId = dependencies.randomId ?? randomUUID;
  const logger = dependencies.logger ?? silentLogger;

  async function acquireIntegrationLease(
    repositories: UserRepositories,
    integrationId: string
  ): Promise<string> {
    const acquiredAt = clock();
    const leaseOwner = `google-refresh:${randomId()}`;
    const acquired = await repositories.integrationRefreshLeases.tryAcquire({
      integrationId,
      leaseOwner,
      now: acquiredAt.toISOString(),
      leaseExpiresAt: new Date(acquiredAt.getTime() + 30_000).toISOString()
    });
    if (!acquired) {
      throw new GoogleIntegrationOAuthError("integration_refresh_in_progress", 503);
    }
    return leaseOwner;
  }

  async function appendAudit(
    repositories: UserRepositories,
    input: {
      readonly action: string;
      readonly targetId: string;
      readonly outcome: "recorded" | "denied" | "succeeded" | "failed";
      readonly metadata: Readonly<Record<string, string | boolean | number | null>>;
      readonly errorCategory?: "authentication" | "transient_provider" | "conflict";
    }
  ): Promise<void> {
    const metadata = { ...input.metadata };
    await repositories.activityEvents.append(
      ActivityEventSchema.parse({
        id: randomId(),
        correlationId: randomId(),
        causationId: null,
        actor: "user",
        action: input.action,
        targetType: "google_integration",
        targetId: input.targetId,
        policyDecision: "not_applicable",
        approvalId: null,
        payloadHash: sha256Text(JSON.stringify(metadata)),
        outcome: input.outcome,
        errorCategory:
          input.outcome === "failed" ? (input.errorCategory ?? "authentication") : null,
        metadata,
        occurredAt: nowIso(clock)
      })
    );
  }

  async function consumeState(userId: VeraUserId, rawStateInput: string) {
    const rawState = RawStateSchema.parse(rawStateInput);
    const repositories = dependencies.repositoryProvider.forUser(userId);
    try {
      const state = await repositories.calendarOAuthStates.consume({
        stateHash: sha256Text(rawState),
        consumedAt: nowIso(clock)
      });
      if (
        state.userId !== userId ||
        state.redirectUriHash !== sha256Text(configuration.redirectUri)
      ) {
        throw new GoogleIntegrationOAuthError("invalid_state", 400);
      }
      return { repositories, state };
    } catch (error: unknown) {
      if (error instanceof GoogleIntegrationOAuthError) throw error;
      logger.warn("calendar.oauth.callback_rejected", { userId, reason: "invalid_state" });
      throw new GoogleIntegrationOAuthError("invalid_state", 400);
    }
  }

  return {
    async createAuthorization(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const capability = CalendarCapabilitySchema.parse(input.capability);
      const returnTo = SafeReturnToSchema.parse(input.returnTo);
      const scope = calendarScope(capability);
      const repositories = dependencies.repositoryProvider.forUser(userId);
      const existing = await onlyGoogleConnection(repositories);
      const rawState = base64Url(randomBytes(32));
      const verifier = base64Url(randomBytes(32));
      const stateId = IntegrationIdSchema.parse(randomId());
      const createdAt = nowIso(clock);
      const encryptedPkceVerifier = await encryptCredential(
        verifier,
        { userId, integrationId: stateId, provider: "google" },
        configuration.credentialKeyProvider,
        { randomBytes }
      );
      const oauthState = CalendarOAuthStateSchema.parse({
        id: stateId,
        userId,
        stateHash: sha256Text(rawState),
        capability,
        requestedCalendarScopes: [scope],
        encryptedPkceVerifier,
        redirectUriHash: sha256Text(configuration.redirectUri),
        returnTo,
        createdAt,
        expiresAt: new Date(
          Date.parse(createdAt) + configuration.oauthStateTtlMilliseconds
        ).toISOString(),
        consumedAt: null
      });

      const codeChallenge = pkceChallenge(verifier);
      const authorizationUrl = transport.createAuthorizationUrl({
        state: rawState,
        scopes: [OPENID_SCOPE, EMAIL_SCOPE, scope],
        codeChallenge,
        prompt: existing?.encryptedRefreshToken ? null : "consent"
      });
      const parsedUrl = validateAuthorizationUrl(authorizationUrl, {
        configuration,
        state: rawState,
        scope,
        codeChallenge
      });
      await dependencies.repositoryProvider.transaction(userId, async (transactionRepositories) => {
        await transactionRepositories.calendarOAuthStates.insert(oauthState);
        await appendAudit(transactionRepositories, {
          action: "calendar.authorization_requested",
          targetId: stateId,
          outcome: "recorded",
          metadata: { capability }
        });
      });
      logger.info("calendar.oauth.authorization_requested", { userId, capability });
      return { authorizationUrl: parsedUrl.href };
    },

    async handleCallback(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const code = AuthorizationCodeSchema.parse(input.code);
      const { repositories, state } = await consumeState(userId, input.state);

      try {
        const verifier = await decryptCredential(
          state.encryptedPkceVerifier,
          { userId, integrationId: state.id, provider: "google" },
          configuration.credentialKeyProvider
        );
        const tokens = await withBoundedProviderCall(
          () => transport.exchangeCode({ code, codeVerifier: verifier }),
          configuration.providerTimeoutMilliseconds
        );
        const identity = await withBoundedProviderCall(
          () => transport.verifyIdentity(tokens.idToken),
          configuration.providerTimeoutMilliseconds
        );
        const tokenInfo = await withBoundedProviderCall(
          () => transport.inspectAccessToken(tokens.accessToken),
          configuration.providerTimeoutMilliseconds
        );
        if (
          !identity.emailVerified ||
          tokenInfo.audience !== configuration.clientId ||
          (tokenInfo.subject !== null && tokenInfo.subject !== identity.subject)
        ) {
          throw new GoogleOAuthProviderError("invalid_response", false);
        }

        const existing = await onlyGoogleConnection(repositories);
        if (
          existing !== null &&
          existing.status !== "disconnected" &&
          existing.providerSubjectId !== identity.subject
        ) {
          throw new GoogleIntegrationOAuthError("account_linking_conflict", 409);
        }
        const connectionId = existing?.id ?? IntegrationIdSchema.parse(randomId());
        const encryptedRefreshToken = tokens.refreshToken
          ? await encryptCredential(
              tokens.refreshToken,
              { userId, integrationId: connectionId, provider: "google" },
              configuration.credentialKeyProvider,
              { randomBytes }
            )
          : (existing?.encryptedRefreshToken ?? null);
        const verifiedScopes = verifiedGrantedScopes(tokenInfo.scopes);
        const requiredScope = state.requestedCalendarScopes[0];
        const status =
          encryptedRefreshToken === null
            ? "reconnect_required"
            : verifiedScopes.includes(OPENID_SCOPE) &&
                verifiedScopes.includes(EMAIL_SCOPE) &&
                verifiedScopes.includes(requiredScope)
              ? "connected"
              : "partial";
        const timestamp = nowIso(clock);
        const connection = IntegrationConnectionSchema.parse({
          id: connectionId,
          userId,
          provider: "google",
          providerSubjectId: identity.subject,
          displayEmail: identity.email,
          encryptedRefreshToken,
          grantedScopes: verifiedScopes,
          tokenExpiresAt: tokenInfo.expiresAt ?? tokens.expiresAt,
          status,
          lastSuccessfulUseAt: null,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp
        });
        const persisted = await dependencies.repositoryProvider.transaction(
          userId,
          async (transactionRepositories) => {
            const saved = await transactionRepositories.integrationConnections.upsert(connection);
            await appendAudit(transactionRepositories, {
              action: "calendar.authorization_completed",
              targetId: saved.id,
              outcome: "succeeded",
              metadata: { capability: state.capability, state: status }
            });
            return saved;
          }
        );
        logger.info("calendar.oauth.callback_completed", {
          userId,
          capability: state.capability,
          status
        });
        return persisted;
      } catch (error: unknown) {
        await appendAudit(repositories, {
          action: "calendar.authorization_denied",
          targetId: state.id,
          outcome: "failed",
          errorCategory:
            error instanceof GoogleIntegrationOAuthError &&
            error.code === "account_linking_conflict"
              ? "conflict"
              : error instanceof GoogleOAuthProviderError && error.retryable
                ? "transient_provider"
                : "authentication",
          metadata: {
            capability: state.capability,
            safeErrorCode:
              error instanceof GoogleIntegrationOAuthError
                ? error.code
                : error instanceof GoogleOAuthProviderError
                  ? error.code
                  : "provider_unavailable"
          }
        });
        logger.warn("calendar.oauth.callback_failed", {
          userId,
          capability: state.capability,
          reason:
            error instanceof GoogleIntegrationOAuthError
              ? error.code
              : error instanceof GoogleOAuthProviderError
                ? error.code
                : "provider_unavailable"
        });
        throw providerFailure(error);
      }
    },

    async handleDeniedCallback(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const { repositories, state } = await consumeState(userId, input.state);
      await appendAudit(repositories, {
        action: "calendar.authorization_denied",
        targetId: state.id,
        outcome: "denied",
        metadata: { capability: state.capability }
      });
      logger.info("calendar.oauth.consent_denied", { userId, capability: state.capability });
    },

    async refreshAccessToken(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const requiredScope = AllowedRefreshScopeSchema.parse(input.requiredScope);
      const capability = auditCapabilityForScope(requiredScope);
      const repositories = dependencies.repositoryProvider.forUser(userId);
      const existing = await onlyGoogleConnection(repositories);
      if (existing === null || existing.status === "disconnected") {
        throw new GoogleIntegrationOAuthError("google_disconnected", 409);
      }
      if (!existing.grantedScopes.includes(requiredScope)) {
        throw new GoogleIntegrationOAuthError("scope_not_granted", 403);
      }
      if (
        existing.encryptedRefreshToken === null ||
        ["revoked", "reconnect_required"].includes(existing.status)
      ) {
        throw new GoogleIntegrationOAuthError("reconnect_required", 409);
      }
      const leaseOwner = await acquireIntegrationLease(repositories, existing.id);

      try {
        const refreshToken = await decryptCredential(
          existing.encryptedRefreshToken,
          { userId, integrationId: existing.id, provider: "google" },
          configuration.credentialKeyProvider
        );
        const refreshed = await retryOneTransient(() =>
          withBoundedProviderCall(
            () => transport.refreshAccessToken(refreshToken),
            configuration.providerTimeoutMilliseconds,
            input.signal
          )
        );
        const tokenInfo = await retryOneTransient(() =>
          withBoundedProviderCall(
            () => transport.inspectAccessToken(refreshed.accessToken),
            configuration.providerTimeoutMilliseconds,
            input.signal
          )
        );
        if (
          tokenInfo.audience !== configuration.clientId ||
          (tokenInfo.subject !== null && tokenInfo.subject !== existing.providerSubjectId)
        ) {
          throw new GoogleOAuthProviderError("invalid_response", false);
        }
        const verifiedScopes = verifiedGrantedScopes(tokenInfo.scopes);
        const requiredScopeGranted = verifiedScopes.includes(requiredScope);
        const replacementEnvelope = refreshed.refreshToken
          ? await encryptCredential(
              refreshed.refreshToken,
              { userId, integrationId: existing.id, provider: "google" },
              configuration.credentialKeyProvider,
              { randomBytes }
            )
          : existing.encryptedRefreshToken;
        const timestamp = nowIso(clock);
        const refreshedConnection = IntegrationConnectionSchema.parse({
          ...existing,
          encryptedRefreshToken: replacementEnvelope,
          grantedScopes: verifiedScopes,
          tokenExpiresAt: tokenInfo.expiresAt ?? refreshed.expiresAt,
          status:
            requiredScopeGranted &&
            verifiedScopes.includes(OPENID_SCOPE) &&
            verifiedScopes.includes(EMAIL_SCOPE)
              ? "connected"
              : "partial",
          lastSuccessfulUseAt: timestamp,
          updatedAt: timestamp
        });
        await dependencies.repositoryProvider.transaction(
          userId,
          async (transactionRepositories) => {
            await transactionRepositories.integrationConnections.upsert(refreshedConnection);
            if (existing.status !== refreshedConnection.status) {
              await appendAudit(transactionRepositories, {
                action: requiredScopeGranted
                  ? "calendar.authorization_completed"
                  : "calendar.authorization_denied",
                targetId: existing.id,
                outcome: requiredScopeGranted ? "succeeded" : "denied",
                metadata: {
                  capability,
                  state: refreshedConnection.status,
                  safeErrorCode: requiredScopeGranted ? null : "scope_not_granted"
                }
              });
            }
          }
        );
        if (!requiredScopeGranted) {
          throw new GoogleIntegrationOAuthError("scope_not_granted", 403);
        }
        logger.info("calendar.oauth.token_refreshed", { userId, capability });
        return AccessTokenSchema.parse(refreshed.accessToken);
      } catch (error: unknown) {
        if (error instanceof GoogleOAuthProviderError && error.code === "invalid_grant") {
          const timestamp = nowIso(clock);
          await dependencies.repositoryProvider.transaction(
            userId,
            async (transactionRepositories) => {
              await transactionRepositories.integrationConnections.upsert({
                ...existing,
                encryptedRefreshToken: null,
                status: "revoked",
                tokenExpiresAt: null,
                updatedAt: timestamp
              });
              await appendAudit(transactionRepositories, {
                action: "calendar.authorization_denied",
                targetId: existing.id,
                outcome: "recorded",
                metadata: { capability, state: "revoked", safeErrorCode: "invalid_grant" }
              });
            }
          );
          logger.warn("calendar.oauth.token_revoked", { userId, capability });
          throw new GoogleIntegrationOAuthError("reconnect_required", 409);
        }
        throw providerFailure(error);
      } finally {
        await repositories.integrationRefreshLeases.release({
          integrationId: existing.id,
          leaseOwner
        });
      }
    },

    async disconnect(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const repositories = dependencies.repositoryProvider.forUser(userId);
      const existing = await onlyGoogleConnection(repositories);
      if (existing === null) return;
      const leaseOwner = await acquireIntegrationLease(repositories, existing.id);
      try {
        let providerRevocationConfirmed = existing.encryptedRefreshToken === null;
        if (existing.encryptedRefreshToken !== null) {
          try {
            const refreshToken = await decryptCredential(
              existing.encryptedRefreshToken,
              { userId, integrationId: existing.id, provider: "google" },
              configuration.credentialKeyProvider
            );
            await retryOneTransient(() =>
              withBoundedProviderCall(
                () => transport.revokeToken(refreshToken),
                configuration.providerTimeoutMilliseconds
              )
            );
            providerRevocationConfirmed = true;
          } catch (error: unknown) {
            if (error instanceof GoogleOAuthProviderError && error.code === "invalid_grant") {
              providerRevocationConfirmed = true;
            }
          }
        }
        const timestamp = nowIso(clock);
        await dependencies.repositoryProvider.transaction(
          userId,
          async (transactionRepositories) => {
            await transactionRepositories.integrationConnections.upsert({
              ...existing,
              encryptedRefreshToken: null,
              grantedScopes: [],
              tokenExpiresAt: null,
              status: "disconnected",
              updatedAt: timestamp
            });
            const gmailSchedules = (
              await transactionRepositories.productionSchedules.list()
            ).filter(
              (schedule) =>
                schedule.kind === "gmail_alert_ingestion" && schedule.state !== "disabled_by_policy"
            );
            for (const schedule of gmailSchedules) {
              await transactionRepositories.productionSchedules.upsert({
                ...schedule,
                state: "disabled_by_policy",
                updatedAt: timestamp
              });
            }
            await appendAudit(transactionRepositories, {
              action: "calendar.authorization_completed",
              targetId: existing.id,
              outcome: "succeeded",
              metadata: {
                state: "disconnected",
                safeErrorCode: providerRevocationConfirmed
                  ? null
                  : "provider_revocation_unconfirmed"
              }
            });
          }
        );
        if (!providerRevocationConfirmed) {
          logger.warn("calendar.oauth.disconnected_revocation_unconfirmed", {
            userId,
            provider: "google",
            manualProviderRevocationRequired: true
          });
          throw new GoogleIntegrationOAuthError("provider_revocation_unconfirmed", 503);
        }
        logger.info("calendar.oauth.disconnected", {
          userId,
          provider: "google",
          manualProviderRevocationRequired: false
        });
      } finally {
        await repositories.integrationRefreshLeases.release({
          integrationId: existing.id,
          leaseOwner
        });
      }
    }
  };
}

export function createGoogleCalendarAuth(
  configuration: GoogleIntegrationEnvironment,
  accessToken: string
) {
  const client = new google.auth.OAuth2({
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
    redirectUri: configuration.redirectUri
  });
  client.setCredentials({ access_token: AccessTokenSchema.parse(accessToken) });
  return client;
}
