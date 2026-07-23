import { CalendarIntegrationStatusResponseSchema } from "@vera/domain";
import { describe, expect, it } from "vitest";

import {
  interpretGoogleDisconnectResponse,
  presentGoogleIntegrationAccount
} from "./integration-cards-view.ts";

const baseStatus = CalendarIntegrationStatusResponseSchema.parse({
  conflictChecking: {
    capability: "calendar_conflict_checking",
    state: "granted",
    accountEmail: "renter@example.test",
    lastSuccessfulUseAt: "2026-07-21T12:00:00.000Z"
  },
  holdCreation: {
    capability: "calendar_hold_creation",
    state: "missing",
    accountEmail: "renter@example.test",
    lastSuccessfulUseAt: "2026-07-21T12:00:00.000Z"
  },
  primaryCalendarOnly: true,
  generatedAt: "2026-07-21T12:05:00.000Z"
});

describe("Google integration settings presentation", () => {
  it("distinguishes a usable connection from an account that needs reconnection", () => {
    expect(presentGoogleIntegrationAccount(baseStatus)).toMatchObject({
      accountDescription: "Connected account: renter@example.test",
      healthLabel: "Connection available",
      showDisconnect: true
    });

    const revoked = CalendarIntegrationStatusResponseSchema.parse({
      ...baseStatus,
      conflictChecking: { ...baseStatus.conflictChecking, state: "revoked" },
      holdCreation: { ...baseStatus.holdCreation, state: "revoked" }
    });
    expect(presentGoogleIntegrationAccount(revoked)).toMatchObject({
      accountDescription: "Previously connected account: renter@example.test",
      healthLabel: "Reconnect required",
      showDisconnect: true
    });
  });

  it("does not claim a disconnected account is connected", () => {
    const disconnected = CalendarIntegrationStatusResponseSchema.parse({
      ...baseStatus,
      conflictChecking: {
        ...baseStatus.conflictChecking,
        state: "disconnected",
        accountEmail: null,
        lastSuccessfulUseAt: null
      },
      holdCreation: {
        ...baseStatus.holdCreation,
        state: "disconnected",
        accountEmail: null,
        lastSuccessfulUseAt: null
      }
    });

    expect(presentGoogleIntegrationAccount(disconnected)).toEqual({
      accountDescription: "No Google account is connected.",
      healthLabel: "Disconnected",
      capabilityAvailable: false,
      showDisconnect: false
    });
  });

  it("validates disconnect success before updating local connection state", () => {
    expect(
      interpretGoogleDisconnectResponse(200, {
        status: "disconnected",
        message: "Google Calendar disconnected."
      })
    ).toEqual({ disconnected: true, warning: null, error: null });

    expect(
      interpretGoogleDisconnectResponse(200, {
        status: "connected",
        message: "PRIVATE PROVIDER BODY"
      })
    ).toEqual({
      disconnected: false,
      warning: null,
      error: "Google Calendar could not be disconnected."
    });
  });

  it("reflects local disconnect when provider revocation is unconfirmed", () => {
    const result = interpretGoogleDisconnectResponse(503, {
      code: "provider_revocation_unconfirmed",
      message: "PRIVATE PROVIDER BODY"
    });

    expect(result).toEqual({
      disconnected: true,
      warning:
        "Google Calendar was disconnected from Vera, but Google revocation could not be confirmed. Revoke Vera in your Google Account permissions.",
      error: null
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE PROVIDER BODY");
  });
});
