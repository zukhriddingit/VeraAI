import { createHash, createHmac, randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

import {
  GMAIL_READONLY_SCOPE,
  GmailOAuthStateSchema,
  IntegrationConnectionSchema,
  IntegrationIdSchema,
  SafeReturnToSchema,
  VeraUserIdSchema,
  type IntegrationConnection,
  type VeraUserId
} from "@vera/domain";
import {
  encryptCredential,
  sha256Text,
  type UserRepositories,
  type UserRepositoryProvider
} from "@vera/db";
import { z } from "zod";

import {
  GoogleIntegrationOAuthError,
  GoogleOAuthProviderError,
  createOfficialGoogleOAuthTransport,
  type GoogleOAuthTransport
} from "./google-integration-oauth.ts";
import type { GoogleIntegrationEnvironment } from "./integration-config.ts";

const STATE_SCHEMA = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const CODE_SCHEMA = z.string().min(1).max(4_096);
const OPENID_SCOPE = "openid";
const EMAIL_SCOPE = "email";
const ALLOWED_RETURN_PATH = "/settings/integrations" as const;
const GMAIL_SCHEDULE_ID = "gmail-alert-ingestion-primary";
const GMAIL_SOURCE_CONFIGURATION_ID = "gmail-alerts-primary";
const ALLOWED_SCOPES = new Set([
  OPENID_SCOPE,
  EMAIL_SCOPE,
  GMAIL_READONLY_SCOPE,
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned"
]);

export interface GmailIntegrationOAuth {
  createAuthorization(input: {
    readonly userId: VeraUserId;
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
}

export interface GmailIntegrationOAuthDependencies {
  readonly configuration: GoogleIntegrationEnvironment;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly transport?: GoogleOAuthTransport;
  readonly clock?: () => Date;
  readonly randomBytes?: (size: number) => Buffer;
  readonly randomId?: () => string;
}

function verifier(configuration: GoogleIntegrationEnvironment, state: string): string {
  return createHmac("sha256", configuration.clientSecret)
    .update(`vera-gmail-pkce:v1:${state}`, "utf8")
    .digest("base64url");
}

function challenge(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

async function googleConnection(
  repositories: UserRepositories
): Promise<IntegrationConnection | null> {
  const connections = (await repositories.integrationConnections.list()).filter(
    (connection) => connection.provider === "google"
  );
  if (connections.length > 1) {
    throw new GoogleIntegrationOAuthError("account_linking_conflict", 409);
  }
  return connections[0] ?? null;
}

function verifiedScopes(scopes: readonly string[]): string[] {
  const unique = [...new Set(scopes)].sort();
  if (unique.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    throw new GoogleOAuthProviderError("invalid_response", false);
  }
  return unique;
}

function providerError(error: unknown): GoogleIntegrationOAuthError {
  if (error instanceof GoogleIntegrationOAuthError) return error;
  if (error instanceof GoogleOAuthProviderError && error.code === "access_denied") {
    return new GoogleIntegrationOAuthError("provider_denied", 403);
  }
  return new GoogleIntegrationOAuthError("provider_unavailable", 503);
}

export function createGmailIntegrationOAuth(
  dependencies: GmailIntegrationOAuthDependencies
): GmailIntegrationOAuth {
  const configuration = dependencies.configuration;
  const gmailConfiguration = { ...configuration, redirectUri: configuration.gmailRedirectUri };
  const transport =
    dependencies.transport ?? createOfficialGoogleOAuthTransport(gmailConfiguration);
  const clock = dependencies.clock ?? (() => new Date());
  const randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  const randomId = dependencies.randomId ?? randomUUID;

  async function consume(userId: VeraUserId, rawStateInput: string) {
    const rawState = STATE_SCHEMA.parse(rawStateInput);
    try {
      const repositories = dependencies.repositoryProvider.forUser(userId);
      const state = await repositories.gmailOAuthStates.consume(
        sha256Text(rawState),
        clock().toISOString()
      );
      if (
        state.userId !== userId ||
        state.codeVerifierHash !== sha256Text(verifier(configuration, rawState))
      ) {
        throw new GoogleIntegrationOAuthError("invalid_state", 400);
      }
      return { rawState, repositories, state };
    } catch (error: unknown) {
      if (error instanceof GoogleIntegrationOAuthError) throw error;
      throw new GoogleIntegrationOAuthError("invalid_state", 400);
    }
  }

  async function audit(
    repositories: UserRepositories,
    input: {
      readonly action: string;
      readonly targetId: string;
      readonly outcome: "recorded" | "succeeded" | "denied" | "failed";
      readonly status: string;
    }
  ) {
    const at = clock().toISOString();
    await repositories.activityEvents.append({
      id: randomId(),
      correlationId: randomId(),
      causationId: null,
      actor: "user",
      action: input.action,
      targetType: "google_integration",
      targetId: input.targetId,
      policyDecision: "not_applicable",
      approvalId: null,
      payloadHash: sha256Text(`gmail-oauth-audit:v1:${input.action}:${input.status}`),
      outcome: input.outcome,
      errorCategory: input.outcome === "failed" ? "authentication" : null,
      metadata: { capability: "gmail_alert_ingestion", status: input.status },
      occurredAt: at
    });
  }

  return {
    async createAuthorization(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const returnTo = SafeReturnToSchema.parse(input.returnTo);
      if (returnTo !== ALLOWED_RETURN_PATH)
        throw new GoogleIntegrationOAuthError("invalid_callback", 400);
      const repositories = dependencies.repositoryProvider.forUser(userId);
      const existing = await googleConnection(repositories);
      const rawState = randomBytes(32).toString("base64url");
      const codeVerifier = verifier(configuration, rawState);
      const createdAt = clock().toISOString();
      const stateId = randomId();
      const state = GmailOAuthStateSchema.parse({
        id: stateId,
        userId,
        stateHash: sha256Text(rawState),
        codeVerifierHash: sha256Text(codeVerifier),
        redirectPath: ALLOWED_RETURN_PATH,
        requestedScopes: [GMAIL_READONLY_SCOPE],
        createdAt,
        expiresAt: new Date(
          Date.parse(createdAt) + configuration.oauthStateTtlMilliseconds
        ).toISOString(),
        consumedAt: null
      });
      const authorizationUrl = transport.createAuthorizationUrl({
        state: rawState,
        scopes: [OPENID_SCOPE, EMAIL_SCOPE, GMAIL_READONLY_SCOPE],
        codeChallenge: challenge(codeVerifier),
        prompt: existing?.encryptedRefreshToken ? null : "consent"
      });
      const url = new URL(authorizationUrl);
      if (
        url.origin !== "https://accounts.google.com" ||
        url.searchParams.get("state") !== rawState ||
        url.searchParams.get("redirect_uri") !== configuration.gmailRedirectUri ||
        !url.searchParams.get("scope")?.split(" ").includes(GMAIL_READONLY_SCOPE)
      ) {
        throw new GoogleIntegrationOAuthError("provider_unavailable", 503);
      }
      await dependencies.repositoryProvider.transaction(userId, async (transactionRepositories) => {
        await transactionRepositories.gmailOAuthStates.insert(state);
        await audit(transactionRepositories, {
          action: "gmail.authorization_requested",
          targetId: stateId,
          outcome: "recorded",
          status: "requested"
        });
      });
      return { authorizationUrl: url.href };
    },

    async handleCallback(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const code = CODE_SCHEMA.parse(input.code);
      const consumed = await consume(userId, input.state);
      try {
        const tokens = await transport.exchangeCode({
          code,
          codeVerifier: verifier(configuration, consumed.rawState)
        });
        const identity = await transport.verifyIdentity(tokens.idToken);
        const tokenInfo = await transport.inspectAccessToken(tokens.accessToken);
        if (
          !identity.emailVerified ||
          tokenInfo.audience !== configuration.clientId ||
          (tokenInfo.subject !== null && tokenInfo.subject !== identity.subject)
        ) {
          throw new GoogleOAuthProviderError("invalid_response", false);
        }
        const scopes = verifiedScopes(tokenInfo.scopes);
        const existing = await googleConnection(consumed.repositories);
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
        const at = clock().toISOString();
        const status =
          encryptedRefreshToken !== null && scopes.includes(GMAIL_READONLY_SCOPE)
            ? "connected"
            : encryptedRefreshToken === null
              ? "reconnect_required"
              : "partial";
        const connection = IntegrationConnectionSchema.parse({
          id: connectionId,
          userId,
          provider: "google",
          providerSubjectId: identity.subject,
          displayEmail: identity.email,
          encryptedRefreshToken,
          grantedScopes: scopes,
          tokenExpiresAt: tokenInfo.expiresAt ?? tokens.expiresAt,
          status,
          lastSuccessfulUseAt: existing?.lastSuccessfulUseAt ?? null,
          createdAt: existing?.createdAt ?? at,
          updatedAt: at
        });
        return dependencies.repositoryProvider.transaction(userId, async (repositories) => {
          const saved = await repositories.integrationConnections.upsert(connection);
          if (scopes.includes(GMAIL_READONLY_SCOPE) && encryptedRefreshToken !== null) {
            const existingSchedule =
              await repositories.productionSchedules.getById(GMAIL_SCHEDULE_ID);
            await repositories.productionSchedules.upsert({
              id: GMAIL_SCHEDULE_ID,
              userId,
              kind: "gmail_alert_ingestion",
              state: "enabled",
              intervalSeconds: 300,
              sourceConfigurationId: GMAIL_SOURCE_CONFIGURATION_ID,
              nextRunAt: new Date(Date.parse(at) + 300_000).toISOString(),
              lastRunAt: existingSchedule?.lastRunAt ?? null,
              createdAt: existingSchedule?.createdAt ?? at,
              updatedAt: at
            });
          }
          await audit(repositories, {
            action: scopes.includes(GMAIL_READONLY_SCOPE)
              ? "gmail.authorization_completed"
              : "gmail.authorization_partial",
            targetId: saved.id,
            outcome: scopes.includes(GMAIL_READONLY_SCOPE) ? "succeeded" : "denied",
            status
          });
          return saved;
        });
      } catch (error: unknown) {
        await audit(consumed.repositories, {
          action: "gmail.authorization_failed",
          targetId: consumed.state.id,
          outcome: "failed",
          status: error instanceof GoogleIntegrationOAuthError ? error.code : "provider_unavailable"
        });
        throw providerError(error);
      }
    },

    async handleDeniedCallback(input) {
      const userId = VeraUserIdSchema.parse(input.userId);
      const consumed = await consume(userId, input.state);
      await audit(consumed.repositories, {
        action: "gmail.authorization_denied",
        targetId: consumed.state.id,
        outcome: "denied",
        status: "provider_denied"
      });
    }
  };
}
