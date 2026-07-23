import { describe, expect, it } from "vitest";

import { createMaritimeControlPlaneClient } from "./maritime-client.ts";

const ready =
  process.env.VERA_MARITIME_STAGING_TEST === "1" &&
  Boolean(process.env.MARITIME_API_KEY?.trim()) &&
  Boolean(process.env.VERA_MARITIME_WORKER_AGENT_ID?.trim());

describe.skipIf(!ready)("Maritime staging status smoke", () => {
  it("reads the configured worker status without dispatching work", async () => {
    const client = createMaritimeControlPlaneClient(process.env);
    const status = await client.getStatus(process.env.VERA_MARITIME_WORKER_AGENT_ID!);
    expect(status.agentId).toBe(process.env.VERA_MARITIME_WORKER_AGENT_ID);
    expect(["sleeping", "starting", "running", "unavailable", "stopped"]).toContain(status.status);
  });
});
