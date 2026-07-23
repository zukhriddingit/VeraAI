import {
  CalendarOAuthStateSchema,
  type ActivityEvent,
  type CalendarOAuthState,
  type IntegrationConnection,
  type IntegrationProvider,
  type ProductionSchedule,
  type VeraUserId
} from "@vera/domain";
import type {
  IntegrationRefreshLeaseInput,
  IntegrationRefreshLeaseReleaseInput,
  UserRepositories,
  UserRepositoryProvider
} from "@vera/db";

import {
  GoogleOAuthProviderError,
  createGoogleIntegrationOAuth,
  type GoogleIntegrationOAuth,
  type GoogleOAuthTokenSet,
  type GoogleOAuthTransport,
  type RefreshedGoogleAccessToken,
  type SafeOAuthLogger,
  type VerifiedGoogleIdentity,
  type VerifiedGoogleTokenInfo
} from "./google-integration-oauth.ts";
import type { GoogleIntegrationEnvironment } from "./integration-config.ts";
import { StaticCredentialKeyProvider } from "@vera/db";
import type { VeraApplication } from "./application-registry.ts";
import { clearApplicationForTesting, registerApplication } from "./application-registry.ts";

export const FIXED_VERA_USER_ID = "018f9f64-7b5a-7c91-a12e-111111111111" as VeraUserId;
export const OTHER_VERA_USER_ID = "018f9f64-7b5a-7c91-a12e-222222222222" as VeraUserId;
export const FIXED_NOW = "2026-07-21T16:00:00.000Z";

export type CallbackFailure =
  "state_mismatch" | "expired_state" | "wrong_vera_user" | "reused_state" | "partial_grant";

export interface ScriptedOAuthTransport extends GoogleOAuthTransport {
  readonly authorizationCalls: Array<Parameters<GoogleOAuthTransport["createAuthorizationUrl"]>[0]>;
  readonly exchangeCalls: Array<Parameters<GoogleOAuthTransport["exchangeCode"]>[0]>;
  readonly refreshCalls: string[];
  readonly revocationCalls: string[];
  tokenSet: GoogleOAuthTokenSet | GoogleOAuthProviderError;
  identity: VerifiedGoogleIdentity | GoogleOAuthProviderError;
  tokenInfo: VerifiedGoogleTokenInfo | GoogleOAuthProviderError;
  refreshed: RefreshedGoogleAccessToken | GoogleOAuthProviderError;
  readonly refreshScript: Array<RefreshedGoogleAccessToken | GoogleOAuthProviderError>;
  revocationError: GoogleOAuthProviderError | null;
}

export interface GoogleOAuthFixture {
  readonly oauth: GoogleIntegrationOAuth;
  readonly transport: ScriptedOAuthTransport;
  readonly states: Map<string, CalendarOAuthState>;
  readonly connections: Map<string, IntegrationConnection>;
  readonly activities: ActivityEvent[];
  readonly logs: string[];
  readonly refreshLeases: Map<string, { readonly owner: string; readonly expiresAt: string }>;
  readonly configuration: GoogleIntegrationEnvironment;
}

function scriptedTransport(configuration: GoogleIntegrationEnvironment): ScriptedOAuthTransport {
  const transport: ScriptedOAuthTransport = {
    authorizationCalls: [],
    exchangeCalls: [],
    refreshCalls: [],
    revocationCalls: [],
    tokenSet: {
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      idToken: "synthetic-id-token",
      expiresAt: "2026-07-21T17:00:00.000Z"
    },
    identity: {
      subject: "synthetic-google-subject",
      email: "renter@example.test",
      emailVerified: true
    },
    tokenInfo: {
      audience: "integration-client.apps.example.test",
      subject: "synthetic-google-subject",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy"],
      expiresAt: "2026-07-21T17:00:00.000Z"
    },
    refreshed: {
      accessToken: "synthetic-refreshed-access-token",
      refreshToken: null,
      expiresAt: "2026-07-21T18:00:00.000Z"
    },
    refreshScript: [],
    revocationError: null,
    createAuthorizationUrl(input) {
      transport.authorizationCalls.push(input);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", input.state);
      url.searchParams.set("client_id", configuration.clientId);
      url.searchParams.set("redirect_uri", configuration.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", input.scopes.join(" "));
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("include_granted_scopes", "true");
      if (input.prompt !== null) url.searchParams.set("prompt", input.prompt);
      return url.href;
    },
    async exchangeCode(input) {
      transport.exchangeCalls.push(input);
      if (transport.tokenSet instanceof GoogleOAuthProviderError) throw transport.tokenSet;
      return transport.tokenSet;
    },
    async verifyIdentity() {
      if (transport.identity instanceof GoogleOAuthProviderError) throw transport.identity;
      return transport.identity;
    },
    async inspectAccessToken() {
      if (transport.tokenInfo instanceof GoogleOAuthProviderError) throw transport.tokenInfo;
      return transport.tokenInfo;
    },
    async refreshAccessToken(refreshToken) {
      transport.refreshCalls.push(refreshToken);
      const outcome = transport.refreshScript.shift() ?? transport.refreshed;
      if (outcome instanceof GoogleOAuthProviderError) throw outcome;
      return outcome;
    },
    async revokeToken(refreshToken) {
      transport.revocationCalls.push(refreshToken);
      if (transport.revocationError) throw transport.revocationError;
    }
  };
  return transport;
}

function repositoriesFor(
  userId: VeraUserId,
  states: Map<string, CalendarOAuthState>,
  connections: Map<string, IntegrationConnection>,
  activities: ActivityEvent[],
  refreshLeases: Map<string, { readonly owner: string; readonly expiresAt: string }>
): UserRepositories {
  return {
    calendarOAuthStates: {
      async insert(input: CalendarOAuthState) {
        const state = CalendarOAuthStateSchema.parse(input);
        states.set(state.stateHash, state);
        return state;
      },
      async consume({
        stateHash,
        consumedAt
      }: {
        readonly stateHash: string;
        readonly consumedAt: string;
      }) {
        const state = states.get(stateHash);
        if (
          !state ||
          state.userId !== userId ||
          state.consumedAt !== null ||
          Date.parse(state.expiresAt) <= Date.parse(consumedAt)
        ) {
          throw new Error("OAuth state is unavailable.");
        }
        const consumed = CalendarOAuthStateSchema.parse({ ...state, consumedAt });
        states.set(stateHash, consumed);
        return consumed;
      }
    },
    integrationConnections: {
      async upsert(input: IntegrationConnection) {
        connections.set(input.id, input);
        return input;
      },
      async getById(id: string) {
        const value = connections.get(id);
        return value?.userId === userId ? value : null;
      },
      async getByProviderSubjectId(provider: IntegrationProvider, subject: string) {
        return (
          [...connections.values()].find(
            (value) =>
              value.userId === userId &&
              value.provider === provider &&
              value.providerSubjectId === subject
          ) ?? null
        );
      },
      async list() {
        return [...connections.values()].filter((value) => value.userId === userId);
      },
      async delete(id: string) {
        const value = connections.get(id);
        return value?.userId === userId ? connections.delete(id) : false;
      }
    },
    integrationRefreshLeases: {
      async tryAcquire(input: IntegrationRefreshLeaseInput) {
        const current = refreshLeases.get(input.integrationId);
        if (current && Date.parse(current.expiresAt) > Date.parse(input.now)) return false;
        refreshLeases.set(input.integrationId, {
          owner: input.leaseOwner,
          expiresAt: input.leaseExpiresAt
        });
        return true;
      },
      async release(input: IntegrationRefreshLeaseReleaseInput) {
        const current = refreshLeases.get(input.integrationId);
        if (current?.owner !== input.leaseOwner) return false;
        return refreshLeases.delete(input.integrationId);
      }
    },
    productionSchedules: {
      async list() {
        return [];
      },
      async upsert(schedule: ProductionSchedule) {
        return schedule;
      }
    },
    activityEvents: {
      async append(event: ActivityEvent) {
        activities.push(event);
        return event;
      },
      async getById(id: string) {
        return activities.find((event) => event.id === id) ?? null;
      },
      async list() {
        return [...activities];
      },
      async listByTarget(targetType: string, targetId: string) {
        return activities.filter(
          (event) => event.targetType === targetType && event.targetId === targetId
        );
      },
      async count() {
        return activities.length;
      }
    }
  } as unknown as UserRepositories;
}

export function createOAuthFixture(): GoogleOAuthFixture {
  const states = new Map<string, CalendarOAuthState>();
  const connections = new Map<string, IntegrationConnection>();
  const activities: ActivityEvent[] = [];
  const refreshLeases = new Map<string, { readonly owner: string; readonly expiresAt: string }>();
  const logs: string[] = [];
  const keyProvider = new StaticCredentialKeyProvider(
    "test-key",
    new Map([["test-key", Buffer.alloc(32, 3)]])
  );
  const configuration: GoogleIntegrationEnvironment = {
    clientId: "integration-client.apps.example.test",
    clientSecret: "synthetic-client-secret",
    redirectUri: "https://vera.example.test/api/integrations/google/calendar/callback",
    gmailRedirectUri: "https://vera.example.test/api/integrations/google/gmail/callback",
    publicBaseUrl: "https://vera.example.test",
    oauthStateTtlMilliseconds: 600_000,
    providerTimeoutMilliseconds: 1_000,
    credentialKeyProvider: keyProvider
  };
  const transport = scriptedTransport(configuration);
  const logger: SafeOAuthLogger = {
    info(event, metadata) {
      logs.push(JSON.stringify({ event, metadata }));
    },
    warn(event, metadata) {
      logs.push(JSON.stringify({ event, metadata }));
    }
  };
  let id = 1;
  let randomCall = 0;
  const repositoryProvider: UserRepositoryProvider = {
    forUser(userId) {
      return repositoriesFor(userId, states, connections, activities, refreshLeases);
    },
    async transaction(userId, operation) {
      return operation(repositoriesFor(userId, states, connections, activities, refreshLeases));
    }
  };
  const oauth = createGoogleIntegrationOAuth({
    configuration,
    repositoryProvider,
    transport,
    clock: () => new Date(FIXED_NOW),
    randomId: () => `018f9f64-7b5a-7c91-a12e-${String(id++).padStart(12, "0")}`,
    randomBytes: (size) => Buffer.alloc(size, ++randomCall),
    logger
  });
  return {
    oauth,
    transport,
    states,
    connections,
    activities,
    logs,
    refreshLeases,
    configuration
  };
}

export function registerOAuthRouteApplication(
  fixture: GoogleOAuthFixture,
  sessionUserId: VeraUserId | null = FIXED_VERA_USER_ID,
  mode: "hosted" | "demo" = "hosted"
): void {
  clearApplicationForTesting();
  const repositoryProvider = {
    forUser() {
      return {};
    },
    async transaction() {
      throw new Error("Route fixture transactions are unavailable.");
    }
  };
  registerApplication({
    mode,
    repositoryProvider,
    auth:
      mode === "demo"
        ? null
        : ({
            api: {
              getSession: async () =>
                sessionUserId === null ? null : { user: { id: sessionUserId }, session: {} }
            }
          } as unknown as VeraApplication["auth"]),
    calendar: {
      configurationState: mode === "demo" ? "demo" : "configured",
      oauth: mode === "demo" ? null : fixture.oauth,
      async createClient() {
        throw new Error("Calendar data client is not used in OAuth route tests.");
      }
    },
    demoUserId: mode === "demo" ? FIXED_VERA_USER_ID : null,
    readiness: async () => {
      throw new Error("Readiness is not used in OAuth route tests.");
    },
    close: async () => {}
  } as unknown as VeraApplication);
}

export interface GoogleCallbackFixture {
  readonly fixture: GoogleOAuthFixture;
  readonly kind: CallbackFailure;
}

export interface GoogleCallbackTestResult {
  readonly response: { readonly status: number };
  readonly connection: IntegrationConnection | null;
  readonly codeExchangeCalls: number;
  readonly revocationCallCount: number;
  readonly logs: readonly string[];
}

export function callbackFixture(kind: CallbackFailure): GoogleCallbackFixture {
  return { fixture: createOAuthFixture(), kind };
}

export async function runCallback(input: GoogleCallbackFixture): Promise<GoogleCallbackTestResult> {
  const { fixture, kind } = input;
  if (kind === "partial_grant") {
    fixture.transport.tokenInfo = {
      ...fixture.transport.tokenInfo,
      scopes: ["openid", "email"]
    } as VerifiedGoogleTokenInfo;
  }
  const authorization = await fixture.oauth.createAuthorization({
    userId: FIXED_VERA_USER_ID,
    capability: "calendar_conflict_checking",
    returnTo: "/settings/integrations"
  });
  const realState = new URL(authorization.authorizationUrl).searchParams.get("state") ?? "";
  if (kind === "expired_state") {
    const entry = [...fixture.states.entries()][0];
    if (entry) fixture.states.set(entry[0], { ...entry[1], expiresAt: FIXED_NOW });
  }
  const state = kind === "state_mismatch" ? "A".repeat(43) : realState;
  const userId = kind === "wrong_vera_user" ? OTHER_VERA_USER_ID : FIXED_VERA_USER_ID;
  let status = 200;
  let connection: IntegrationConnection | null = null;
  try {
    connection = await fixture.oauth.handleCallback({
      userId,
      state,
      code: "synthetic-code"
    });
    if (kind === "reused_state") {
      await fixture.oauth.handleCallback({ userId, state, code: "synthetic-code" });
    }
  } catch {
    status = 400;
  }
  return {
    response: { status },
    connection,
    codeExchangeCalls: fixture.transport.exchangeCalls.length,
    revocationCallCount: fixture.transport.revocationCalls.length,
    logs: fixture.logs
  };
}
