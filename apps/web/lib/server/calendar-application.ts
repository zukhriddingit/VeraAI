import { CalendarProviderError, GoogleCalendarClient, type CalendarClient } from "@vera/calendar";
import {
  CalendarGoogleScopeSchema,
  VeraUserIdSchema,
  type CalendarGoogleScope,
  type VeraUserId
} from "@vera/domain";

import {
  createGoogleCalendarAuth,
  type GoogleIntegrationOAuth
} from "./google-integration-oauth.ts";
import type { GoogleIntegrationEnvironment } from "./integration-config.ts";

export interface CalendarApplicationDependencies {
  readonly configurationState: "configured" | "unconfigured" | "demo";
  readonly oauth: GoogleIntegrationOAuth | null;
  createClient(
    userId: VeraUserId,
    requiredScope: CalendarGoogleScope,
    signal?: AbortSignal
  ): Promise<CalendarClient>;
}

export function createUnconfiguredCalendarApplication(): CalendarApplicationDependencies {
  return {
    configurationState: "unconfigured",
    oauth: null,
    async createClient() {
      throw new CalendarProviderError("calendar_disconnected", false, 409);
    }
  };
}

export function createHostedCalendarApplication(input: {
  readonly configuration: GoogleIntegrationEnvironment;
  readonly oauth: GoogleIntegrationOAuth;
  readonly clientFactory?: (accessToken: string) => CalendarClient;
}): CalendarApplicationDependencies {
  const clientFactory =
    input.clientFactory ??
    ((accessToken: string) =>
      new GoogleCalendarClient({
        auth: createGoogleCalendarAuth(input.configuration, accessToken),
        timeoutMilliseconds: input.configuration.providerTimeoutMilliseconds
      }));

  return {
    configurationState: "configured",
    oauth: input.oauth,
    async createClient(userIdInput, requiredScopeInput, signal) {
      const userId = VeraUserIdSchema.parse(userIdInput);
      const requiredScope = CalendarGoogleScopeSchema.parse(requiredScopeInput);
      const accessToken = await input.oauth.refreshAccessToken({
        userId,
        requiredScope,
        ...(signal === undefined ? {} : { signal })
      });
      return clientFactory(accessToken);
    }
  };
}
