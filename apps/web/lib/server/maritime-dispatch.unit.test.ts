import type { UserRepositories } from "@vera/db";
import { FounderBrowserAuthorizationError, type VeraUserId } from "@vera/domain";
import { describe, expect, it, vi } from "vitest";

import { dispatchHostedSourceJob } from "./maritime-dispatch.ts";

const founder = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const other = "118f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;

describe("hosted browser dispatch authorization", () => {
  it("denies a non-founder before reading a job or waking Maritime", async () => {
    const getJob = vi.fn();
    const wake = vi.fn();
    const repositories = {
      sourceJobs: { getById: getJob }
    } as unknown as UserRepositories;

    await expect(
      dispatchHostedSourceJob(
        {
          userId: other,
          repositories,
          environment: {
            VERA_MARITIME_WORKER_AGENT_ID: "agent-worker-founder",
            VERA_BROWSER_FOUNDER_USER_IDS: founder
          },
          client: {
            wakeAgent: wake
          } as never
        },
        "source-job-founder-boundary"
      )
    ).rejects.toEqual(new FounderBrowserAuthorizationError("founder_browser_user_denied"));

    expect(getJob).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
  });
});
