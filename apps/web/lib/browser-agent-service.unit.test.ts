import type { UserRepositories, UserRepositoryProvider } from "@vera/db";
import {
  FounderBrowserAuthorizationError,
  type BrowserControlMutation,
  type CreateCurrentTabCaptureRequest,
  type VeraUserId
} from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { createCurrentTabCaptureJob, mutateBrowserControls } from "./browser-agent-service.ts";

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

describe("browser-agent control activation", () => {
  it.each([
    { userBrowserEnabled: true },
    { zillowSourceEnabled: true },
    { nodeId: "founder-node", nodeEnabled: true },
    {
      nodeId: "founder-node",
      profileId: "vera-zillow",
      profileEnabled: true
    }
  ] satisfies readonly BrowserControlMutation[])(
    "rejects enablement before repository access while the global kill switch is active",
    async (mutation) => {
      const getControl = vi.fn();
      const upsertControl = vi.fn();
      const getNode = vi.fn();
      const upsertNode = vi.fn();
      const getProfile = vi.fn();
      const upsertProfile = vi.fn();
      const repositories = {
        browserIntegrationControls: { get: getControl, upsert: upsertControl },
        browserNodes: { getById: getNode, upsert: upsertNode },
        browserProfileControls: { get: getProfile, upsert: upsertProfile }
      } as unknown as UserRepositories;

      await expect(
        mutateBrowserControls(
          {
            repositories,
            systemBrowserDisabled: true,
            now: () => new Date("2026-07-23T15:00:00.000Z"),
            createId: () => "correlation-browser-control"
          },
          mutation
        )
      ).rejects.toThrow(
        "Browser controls cannot be enabled while the system browser kill switch is active."
      );

      for (const operation of [
        getControl,
        upsertControl,
        getNode,
        upsertNode,
        getProfile,
        upsertProfile
      ]) {
        expect(operation).not.toHaveBeenCalled();
      }
    }
  );
});
