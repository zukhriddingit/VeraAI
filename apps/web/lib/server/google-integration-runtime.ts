import type { CalendarGoogleScope, VeraUserId } from "@vera/domain";
import type { UserRepositoryProvider } from "@vera/db";

import type { CalendarApplicationDependencies } from "./calendar-application.ts";
import type { GmailIntegrationOAuth } from "./gmail-integration-oauth.ts";
import {
  GoogleIntegrationOAuthError,
  type GoogleIntegrationOAuth
} from "./google-integration-contracts.ts";
import type { GoogleIntegrationEnvironment } from "./integration-config.ts";

export interface GoogleIntegrationBindings {
  readonly calendar: CalendarApplicationDependencies;
  readonly gmailOAuth: GmailIntegrationOAuth;
}

export interface GoogleIntegrationRuntimeInput {
  readonly configuration: GoogleIntegrationEnvironment;
  readonly repositoryProvider: UserRepositoryProvider;
}

export type GoogleIntegrationRuntimeLoader = (
  input: GoogleIntegrationRuntimeInput
) => Promise<GoogleIntegrationBindings>;

async function loadGoogleIntegrationBindings(
  input: GoogleIntegrationRuntimeInput
): Promise<GoogleIntegrationBindings> {
  const [calendarModule, calendarOAuthModule, gmailOAuthModule] = await Promise.all([
    import("./calendar-application.ts"),
    import("./google-integration-oauth.ts"),
    import("./gmail-integration-oauth.ts")
  ]);
  const oauth = calendarOAuthModule.createGoogleIntegrationOAuth({
    configuration: input.configuration,
    repositoryProvider: input.repositoryProvider
  });
  return {
    calendar: calendarModule.createHostedCalendarApplication({
      configuration: input.configuration,
      oauth
    }),
    gmailOAuth: gmailOAuthModule.createGmailIntegrationOAuth({
      configuration: input.configuration,
      repositoryProvider: input.repositoryProvider
    })
  };
}

export function createLazyGoogleIntegrationBindings(
  input: GoogleIntegrationRuntimeInput & {
    readonly loader?: GoogleIntegrationRuntimeLoader;
  }
): GoogleIntegrationBindings {
  const loader = input.loader ?? loadGoogleIntegrationBindings;
  let pending: Promise<GoogleIntegrationBindings> | null = null;

  const load = (): Promise<GoogleIntegrationBindings> => {
    if (pending !== null) return pending;

    const next = Promise.resolve()
      .then(() =>
        loader({
          configuration: input.configuration,
          repositoryProvider: input.repositoryProvider
        })
      )
      .then((bindings) => {
        if (bindings.calendar.oauth === null) {
          throw new Error("Configured Google Calendar binding must expose OAuth.");
        }
        return bindings;
      })
      .catch(() => {
        if (pending === next) pending = null;
        throw new GoogleIntegrationOAuthError("provider_unavailable", 503);
      });
    pending = next;
    return next;
  };

  const calendarOAuth: GoogleIntegrationOAuth = {
    async createAuthorization(operationInput) {
      const bindings = await load();
      return bindings.calendar.oauth!.createAuthorization(operationInput);
    },
    async handleCallback(operationInput) {
      const bindings = await load();
      return bindings.calendar.oauth!.handleCallback(operationInput);
    },
    async handleDeniedCallback(operationInput) {
      const bindings = await load();
      return bindings.calendar.oauth!.handleDeniedCallback(operationInput);
    },
    async refreshAccessToken(operationInput) {
      const bindings = await load();
      return bindings.calendar.oauth!.refreshAccessToken(operationInput);
    },
    async disconnect(operationInput) {
      const bindings = await load();
      return bindings.calendar.oauth!.disconnect(operationInput);
    }
  };

  const calendar: CalendarApplicationDependencies = {
    configurationState: "configured",
    oauth: calendarOAuth,
    async createClient(
      userId: VeraUserId,
      requiredScope: CalendarGoogleScope,
      signal?: AbortSignal
    ) {
      const bindings = await load();
      return bindings.calendar.createClient(userId, requiredScope, signal);
    }
  };

  const gmailOAuth: GmailIntegrationOAuth = {
    async createAuthorization(operationInput) {
      const bindings = await load();
      return bindings.gmailOAuth.createAuthorization(operationInput);
    },
    async handleCallback(operationInput) {
      const bindings = await load();
      return bindings.gmailOAuth.handleCallback(operationInput);
    },
    async handleDeniedCallback(operationInput) {
      const bindings = await load();
      return bindings.gmailOAuth.handleDeniedCallback(operationInput);
    }
  };

  return { calendar, gmailOAuth };
}
