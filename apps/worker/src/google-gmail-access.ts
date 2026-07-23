import { randomUUID } from "node:crypto";

import { GmailClientError } from "@vera/connectors";
import { decryptCredential, type CredentialKeyProvider, type UserRepositories } from "@vera/db";
import { GMAIL_READONLY_SCOPE, type VeraUserId } from "@vera/domain";

interface TokenResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface TokenFetch {
  (
    url: string,
    init: {
      readonly method: "POST";
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
      readonly signal?: AbortSignal;
    }
  ): Promise<TokenResponse>;
}

const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;

function requestSignal(caller: AbortSignal | undefined, timeoutMilliseconds: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

function requestFailure(caller: AbortSignal | undefined, request: AbortSignal): GmailClientError {
  if (caller?.aborted) return new GmailClientError("gmail_cancelled", true);
  if (request.aborted) return new GmailClientError("gmail_timeout", true);
  return new GmailClientError("gmail_temporarily_unavailable", true);
}

export async function refreshGmailAccessToken(input: {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly keyProvider: CredentialKeyProvider;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly signal?: AbortSignal;
  readonly timeoutMilliseconds?: number;
  readonly fetchImplementation?: TokenFetch;
  readonly now?: () => Date;
  readonly createId?: () => string;
}): Promise<string> {
  const connection = (await input.repositories.integrationConnections.list()).find(
    (candidate) => candidate.provider === "google"
  );
  if (
    !connection ||
    !connection.grantedScopes.includes(GMAIL_READONLY_SCOPE) ||
    connection.encryptedRefreshToken === null ||
    ["disconnected", "revoked", "reconnect_required"].includes(connection.status)
  ) {
    throw new GmailClientError("gmail_authentication", false);
  }
  const clock = input.now ?? (() => new Date());
  const acquiredAt = clock();
  const leaseOwner = `gmail-refresh:${(input.createId ?? randomUUID)()}`;
  const acquired = await input.repositories.integrationRefreshLeases.tryAcquire({
    integrationId: connection.id,
    leaseOwner,
    now: acquiredAt.toISOString(),
    leaseExpiresAt: new Date(acquiredAt.getTime() + 30_000).toISOString()
  });
  if (!acquired) throw new GmailClientError("gmail_temporarily_unavailable", true);
  try {
    const refreshToken = await decryptCredential(
      connection.encryptedRefreshToken,
      { userId: input.userId, integrationId: connection.id, provider: "google" },
      input.keyProvider
    );
    const fetcher = input.fetchImplementation ?? (fetch as unknown as TokenFetch);
    const timeoutMilliseconds = input.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
      throw new TypeError("Google token request timeout must be a positive safe integer.");
    }
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }).toString();
    let response: TokenResponse | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const signal = requestSignal(input.signal, timeoutMilliseconds);
      try {
        response = await fetcher("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal
        });
      } catch (error: unknown) {
        if (error instanceof GmailClientError) throw error;
        throw requestFailure(input.signal, signal);
      }
      if (response.ok || response.status < 500 || attempt === 1) break;
    }
    if (!response) throw new GmailClientError("gmail_temporarily_unavailable", true);
    if (!response.ok) {
      throw new GmailClientError(
        response.status === 429
          ? "gmail_rate_limited"
          : response.status >= 500
            ? "gmail_temporarily_unavailable"
            : "gmail_authentication",
        response.status === 429 || response.status >= 500
      );
    }
    const value = (await response.json()) as unknown;
    if (typeof value !== "object" || value === null) {
      throw new GmailClientError("gmail_invalid_response", false);
    }
    const accessToken = Reflect.get(value, "access_token");
    const scope = Reflect.get(value, "scope");
    if (typeof accessToken !== "string" || accessToken.length < 1 || accessToken.length > 16_384) {
      throw new GmailClientError("gmail_invalid_response", false);
    }
    if (typeof scope === "string" && !scope.split(/\s+/u).includes(GMAIL_READONLY_SCOPE)) {
      throw new GmailClientError("gmail_authentication", false);
    }
    const now = clock().toISOString();
    await input.repositories.integrationConnections.upsert({
      ...connection,
      status: "connected",
      lastSuccessfulUseAt: now,
      updatedAt: now
    });
    return accessToken;
  } finally {
    await input.repositories.integrationRefreshLeases.release({
      integrationId: connection.id,
      leaseOwner
    });
  }
}
