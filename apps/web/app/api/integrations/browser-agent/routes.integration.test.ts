import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDatabase } from "@vera/db/demo";
import { BrowserAgentStatusResponseSchema } from "@vera/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearTestApplication,
  registerTestDemoRuntime
} from "../../../../test-support/demo-runtime.ts";
import { POST as createCapture } from "./captures/route.ts";
import { GET as getStatus } from "./status/route.ts";

const directories: string[] = [];
let connection: ReturnType<typeof registerTestDemoRuntime> | null = null;

afterEach(() => {
  connection?.close();
  connection = null;
  clearTestApplication();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function registerDemo() {
  const directory = mkdtempSync(join(tmpdir(), "vera-browser-agent-routes-"));
  directories.push(directory);
  connection = registerTestDemoRuntime(join(directory, "vera.sqlite"));
  migrateDatabase(connection);
}

describe.sequential("browser-agent API demo boundary", () => {
  it("reports the isolated demo adapter as unsupported and fail-closed", async () => {
    registerDemo();
    const response = await getStatus(
      new Request("http://127.0.0.1/api/integrations/browser-agent/status")
    );
    expect(response.status).toBe(200);
    expect(BrowserAgentStatusResponseSchema.parse(await response.json())).toMatchObject({
      supportStatus: "unsupported_experimental",
      readiness: "disabled_by_policy",
      node: null,
      controls: {
        userBrowserEnabled: false,
        zillowSourceEnabled: false
      }
    });
  });

  it("never queues a live browser capture through deterministic demo composition", async () => {
    registerDemo();
    const response = await createCapture(
      new Request("http://127.0.0.1/api/integrations/browser-agent/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "demo_boundary" });
  });
});
