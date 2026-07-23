import type { UserRepositories, UserRepositoryProvider } from "@vera/db";
import {
  FounderBrowserAuthorizationError,
  type CreateCurrentTabCaptureRequest,
  type VeraUserId
} from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { createCurrentTabCaptureJob } from "./browser-agent-service.ts";

const founder = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const other = "118f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;

const request: CreateCurrentTabCaptureRequest = {
  nodeId: "founder-node",
  profileId: "vera-zillow",
  expectedUrl: "https://www.zillow.com/homedetails/12-Cedar-St/12345_zpid/",
  requestIdempotencyKey: "a".repeat(64),
  confirmation: {
    openedIntendedListing: true,
    approvesVisiblePageCapture: true,
    understandsExperimentalStatus: true,
    understandsNoExternalAction: true
  }
};

describe("browser-agent capture authorization", () => {
  it("denies a non-founder before reading or mutating repositories", async () => {
    const getControl = vi.fn();
    const getNode = vi.fn();
    const getProfile = vi.fn();
    const transaction = vi.fn();
    const repositories = {
      browserIntegrationControls: { get: getControl },
      browserNodes: { getById: getNode },
      browserProfileControls: { get: getProfile }
    } as unknown as UserRepositories;
    const repositoryProvider = { transaction } as unknown as UserRepositoryProvider;

    await expect(
      createCurrentTabCaptureJob(
        {
          repositories,
          repositoryProvider,
          userId: other,
          founderBrowserUserIds: founder,
          systemBrowserDisabled: false,
          now: () => new Date("2026-07-22T15:00:00.000Z"),
          createId: () => "correlation-founder-boundary"
        },
        request
      )
    ).rejects.toEqual(new FounderBrowserAuthorizationError("founder_browser_user_denied"));

    expect(getControl).not.toHaveBeenCalled();
    expect(getNode).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
