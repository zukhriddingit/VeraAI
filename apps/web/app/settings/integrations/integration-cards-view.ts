import type { CalendarCapabilityGrantState, CalendarIntegrationStatusResponse } from "@vera/domain";
import { z } from "zod";

const DisconnectSuccessSchema = z
  .object({
    status: z.literal("disconnected"),
    message: z.string().trim().min(1).max(500)
  })
  .strict();

const RevocationWarningSchema = z
  .object({
    code: z.literal("provider_revocation_unconfirmed"),
    message: z.string().trim().min(1).max(500)
  })
  .strict();

export interface GoogleIntegrationAccountView {
  readonly accountDescription: string;
  readonly healthLabel: string;
  readonly capabilityAvailable: boolean;
  readonly showDisconnect: boolean;
}

export interface GoogleDisconnectInterpretation {
  readonly disconnected: boolean;
  readonly warning: string | null;
  readonly error: string | null;
}

function capabilityStates(
  status: CalendarIntegrationStatusResponse
): readonly CalendarCapabilityGrantState[] {
  return [status.conflictChecking.state, status.holdCreation.state];
}

export function presentGoogleIntegrationAccount(
  status: CalendarIntegrationStatusResponse
): GoogleIntegrationAccountView {
  const states = capabilityStates(status);
  const accountEmail = status.conflictChecking.accountEmail ?? status.holdCreation.accountEmail;
  const capabilityAvailable = states.some((state) => state === "granted");
  const connected = states.some((state) => state === "granted" || state === "missing");
  const reconnectRequired = states.some((state) => state === "expired" || state === "revoked");
  const unconfigured = states.every((state) => state === "unconfigured");

  return {
    accountDescription:
      accountEmail === null
        ? "No Google account is connected."
        : connected
          ? `Connected account: ${accountEmail}`
          : `Previously connected account: ${accountEmail}`,
    healthLabel: capabilityAvailable
      ? "Connection available"
      : reconnectRequired
        ? "Reconnect required"
        : connected
          ? "Connection needs permission"
          : unconfigured
            ? "Integration unavailable"
            : "Disconnected",
    capabilityAvailable,
    showDisconnect: accountEmail !== null && (connected || reconnectRequired)
  };
}

export function interpretGoogleDisconnectResponse(
  httpStatus: number,
  body: unknown
): GoogleDisconnectInterpretation {
  if (httpStatus >= 200 && httpStatus < 300 && DisconnectSuccessSchema.safeParse(body).success) {
    return { disconnected: true, warning: null, error: null };
  }

  if (httpStatus === 503 && RevocationWarningSchema.safeParse(body).success) {
    return {
      disconnected: true,
      warning:
        "Google Calendar was disconnected from Vera, but Google revocation could not be confirmed. Revoke Vera in your Google Account permissions.",
      error: null
    };
  }

  return {
    disconnected: false,
    warning: null,
    error: "Google Calendar could not be disconnected."
  };
}
