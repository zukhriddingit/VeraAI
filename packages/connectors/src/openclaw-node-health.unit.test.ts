import { describe, expect, it } from "vitest";

import type {
  OpenClawProcessInput,
  OpenClawProcessResult,
  OpenClawProcessRunner
} from "./openclaw-cli.ts";
import { OpenClawNodeHealthProvider } from "./openclaw-node-health.ts";

class Runner implements OpenClawProcessRunner {
  readonly calls: OpenClawProcessInput[] = [];
  constructor(private readonly results: readonly OpenClawProcessResult[]) {}
  async run(input: OpenClawProcessInput) {
    this.calls.push(input);
    const result = this.results[this.calls.length - 1];
    if (!result) throw new Error("unexpected OpenClaw call");
    return result;
  }
}

const NOW = "2026-07-22T12:00:00.000Z";

describe("OpenClaw node health provider", () => {
  it("uses only version, nodes status, and nodes describe", async () => {
    const runner = new Runner([
      { exitCode: 0, stdout: "OpenClaw 2026.6.33", stderr: "" },
      {
        exitCode: 0,
        stdout: JSON.stringify({
          nodes: [
            {
              nodeId: "node-1",
              displayName: "Founder Mac",
              connected: true,
              paired: true,
              approvalState: "approved"
            }
          ]
        }),
        stderr: ""
      },
      {
        exitCode: 0,
        stdout: JSON.stringify({
          nodeId: "node-1",
          displayName: "Founder Mac",
          version: "2026.6.33",
          commands: ["browser.proxy"],
          connected: true,
          paired: true,
          approvalState: "approved"
        }),
        stderr: ""
      }
    ]);
    const provider = new OpenClawNodeHealthProvider({
      config: {
        executable: "openclaw",
        gatewayUrl: "wss://gateway.example.test",
        gatewayToken: "test-token-at-least-sixteen-characters",
        timeoutMilliseconds: 10_000,
        maxOutputBytes: 100_000
      },
      runner,
      now: () => new Date(NOW)
    });
    await expect(provider.inspect("node-1", "vera-zillow")).resolves.toMatchObject({
      status: "online",
      pairingState: "paired",
      capabilityApprovalState: "approved",
      reportedOpenClawVersion: "2026.6.33",
      versionCompatibility: "compatible"
    });
    expect(runner.calls.map(({ args }) => args)).toEqual([
      ["--version"],
      ["nodes", "status", "--json"],
      ["nodes", "describe", "--node", "node-1", "--json"]
    ]);
    expect(JSON.stringify(runner.calls)).not.toMatch(/system\.run|camera|screen|location|notify/iu);
  });

  it("reports offline instead of a successful empty node", async () => {
    const runner = new Runner([
      { exitCode: 0, stdout: "2026.6.33", stderr: "" },
      { exitCode: 0, stdout: JSON.stringify({ nodes: [] }), stderr: "" }
    ]);
    const provider = new OpenClawNodeHealthProvider({
      config: {
        executable: "openclaw",
        gatewayUrl: "wss://gateway.example.test",
        gatewayToken: "test-token-at-least-sixteen-characters",
        timeoutMilliseconds: 10_000,
        maxOutputBytes: 100_000
      },
      runner,
      now: () => new Date(NOW)
    });
    await expect(provider.inspect("node-1", "vera-zillow")).resolves.toMatchObject({
      status: "offline",
      pairingState: "not_paired",
      capabilityApprovalState: "not_approved"
    });
  });
});
