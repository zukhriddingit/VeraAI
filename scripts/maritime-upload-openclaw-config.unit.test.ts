import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MARITIME_API_ORIGIN,
  MaritimeConfigUploadError,
  runMaritimeOpenClawConfigUploadCli,
  uploadOpenClawConfig,
  type MaritimeConfigUploadCode,
  type MaritimeFetch
} from "./maritime-upload-openclaw-config.ts";

const AGENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const CORRELATION_ID = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const API_KEY = "mk_unit_test_key_0123456789";
const ROOT = resolve(import.meta.dirname, "..");
const GATEWAY_CONFIG = readFileSync(
  resolve(ROOT, "infra/maritime/openclaw/openclaw.json5"),
  "utf8"
);
const NODE_CONFIG = readFileSync(
  resolve(ROOT, "infra/maritime/openclaw/node.openclaw.json5"),
  "utf8"
);

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uploadInput(fetchImplementation: MaritimeFetch) {
  return {
    apiKey: API_KEY,
    gatewayAgentId: AGENT_ID,
    configText: GATEWAY_CONFIG,
    nodeConfigText: NODE_CONFIG,
    correlationId: CORRELATION_ID,
    fetchImplementation
  } as const;
}

async function expectUploadCode(
  response: Response,
  expectedCode: MaritimeConfigUploadCode
): Promise<void> {
  const fetchImplementation = vi.fn(async () => response);
  const promise = uploadOpenClawConfig(uploadInput(fetchImplementation));
  await expect(promise).rejects.toMatchObject({ code: expectedCode });
}

describe("guarded Maritime OpenClaw config uploader", () => {
  it("POSTs one non-executable reviewed file to the exact UUID-bound endpoint", async () => {
    const fetchImplementation = vi.fn<MaritimeFetch>(
      async () => new Response(JSON.stringify({ files_count: 1 }), { status: 201 })
    );

    const result = await uploadOpenClawConfig(uploadInput(fetchImplementation));

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe(`${MARITIME_API_ORIGIN}/api/v1/agents/${AGENT_ID}/files`);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe(API_KEY);
    expect(headers.get("x-correlation-id")).toBe(CORRELATION_ID);
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      files: [
        {
          path: "openclaw.json",
          content: GATEWAY_CONFIG,
          executable: false,
          run_on_deploy: false,
          target_dir: "/data/.openclaw"
        }
      ]
    });
    expect(result).toEqual({
      correlationId: CORRELATION_ID,
      configSha256: hash(GATEWAY_CONFIG),
      gatewayAgentIdHash: hash(`vera-maritime-agent:${AGENT_ID}`)
    });
  });

  it.each([
    "http://api.maritime.sh",
    "https://api.maritime.sh.evil.example",
    "https://api.maritime.sh:444",
    "https://api.maritime.sh/api/v1",
    "https://user:password@api.maritime.sh",
    "https://api.maritime.sh/?redirect=evil",
    "https://api.maritime.sh/#fragment",
    " https://api.maritime.sh"
  ])("rejects a non-canonical Maritime API origin: %s", async (apiUrl) => {
    const fetchImplementation = vi.fn<MaritimeFetch>();
    await expect(
      uploadOpenClawConfig({ ...uploadInput(fetchImplementation), apiUrl })
    ).rejects.toMatchObject({ code: "maritime_config_rejected" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "agent_123",
    "550E8400-E29B-41D4-A716-446655440000",
    "00000000-0000-0000-0000-000000000000",
    "550e8400-e29b-41d4-a716-446655440000/files"
  ])("rejects a missing, placeholder, or non-canonical agent UUID: %s", async (gatewayAgentId) => {
    const fetchImplementation = vi.fn<MaritimeFetch>();
    await expect(
      uploadOpenClawConfig({ ...uploadInput(fetchImplementation), gatewayAgentId })
    ).rejects.toMatchObject({ code: "maritime_config_rejected" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("requires a scoped API key and never falls back to CLI login credentials", async () => {
    const fetchImplementation = vi.fn<MaritimeFetch>();
    await expect(
      uploadOpenClawConfig({ ...uploadInput(fetchImplementation), apiKey: "" })
    ).rejects.toMatchObject({ code: "maritime_config_authentication_failed" });

    const stderr: string[] = [];
    const exitCode = await runMaritimeOpenClawConfigUploadCli({
      argv: ["--confirm", AGENT_ID],
      environment: {
        MARITIME_TOKEN: "cli-login-token-must-not-be-used",
        VERA_MARITIME_GATEWAY_AGENT_ID: AGENT_ID
      },
      fetchImplementation,
      verifyConfigFiles: async () => [],
      stderr: (value) => stderr.push(value)
    });
    expect(exitCode).toBe(1);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(stderr.join("")).not.toContain("cli-login-token-must-not-be-used");
  });

  it("rejects oversized, invalid, and secret-bearing config before any request", async () => {
    const fetchImplementation = vi.fn<MaritimeFetch>();
    for (const configText of [
      `${GATEWAY_CONFIG}${" ".repeat(128 * 1024)}`,
      "{ invalid:",
      GATEWAY_CONFIG.replace("${OPENCLAW_GATEWAY_TOKEN}", "sk-live-secret-material")
    ]) {
      await expect(
        uploadOpenClawConfig({ ...uploadInput(fetchImplementation), configText })
      ).rejects.toMatchObject({ code: "maritime_config_rejected" });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [401, "maritime_config_authentication_failed"],
    [403, "maritime_config_authentication_failed"],
    [429, "maritime_config_rate_limited"],
    [500, "maritime_config_unavailable"],
    [503, "maritime_config_unavailable"],
    [302, "maritime_config_rejected"],
    [400, "maritime_config_rejected"],
    [404, "maritime_config_rejected"],
    [409, "maritime_config_rejected"]
  ] as const)("maps HTTP %i to the safe code %s", async (status, code) => {
    await expectUploadCode(
      new Response("raw-response-secret-that-must-never-escape", { status }),
      code
    );
  });

  it("bounds response bodies without exposing their content", async () => {
    const secret = "raw-provider-secret";
    const promise = uploadOpenClawConfig(
      uploadInput(async () => new Response(secret.repeat(20_000), { status: 201 }))
    );
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MaritimeConfigUploadError);
    expect(error).toMatchObject({ code: "maritime_config_unavailable" });
    expect(String(error)).not.toContain(secret);
  });

  it("supports bounded timeout and caller cancellation", async () => {
    const pendingFetch: MaritimeFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    await expect(
      uploadOpenClawConfig({ ...uploadInput(pendingFetch), timeoutMilliseconds: 1 })
    ).rejects.toMatchObject({ code: "maritime_config_unavailable" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadOpenClawConfig({ ...uploadInput(pendingFetch), signal: controller.signal })
    ).rejects.toMatchObject({ code: "maritime_config_unavailable" });
  });

  it("fails closed with no network call when --confirm is absent or mismatched", async () => {
    for (const argv of [[], ["--confirm"], ["--confirm", CORRELATION_ID], ["--unknown"]]) {
      const fetchImplementation = vi.fn<MaritimeFetch>();
      const exitCode = await runMaritimeOpenClawConfigUploadCli({
        argv,
        environment: {
          MARITIME_API_KEY: API_KEY,
          VERA_MARITIME_GATEWAY_AGENT_ID: AGENT_ID
        },
        fetchImplementation,
        verifyConfigFiles: async () => [],
        stderr: () => undefined
      });
      expect(exitCode).toBe(1);
      expect(fetchImplementation).not.toHaveBeenCalled();
    }
  });

  it("runs the existing config verifier and emits only hashes/correlation on success", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchImplementation = vi.fn(async () => new Response(null, { status: 201 }));
    const verifyConfigFiles = vi.fn(async () => [] as string[]);
    const exitCode = await runMaritimeOpenClawConfigUploadCli({
      argv: ["--confirm", AGENT_ID],
      environment: {
        MARITIME_API_KEY: API_KEY,
        VERA_MARITIME_GATEWAY_AGENT_ID: AGENT_ID
      },
      fetchImplementation,
      verifyConfigFiles,
      correlationIdFactory: () => CORRELATION_ID,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    });

    expect(exitCode).toBe(0);
    expect(verifyConfigFiles).toHaveBeenCalledTimes(1);
    expect(stderr).toEqual([]);
    const diagnostic = stdout.join("");
    expect(JSON.parse(diagnostic)).toEqual({
      event: "openclaw_config_uploaded",
      correlationId: CORRELATION_ID,
      gatewayAgentIdHash: hash(`vera-maritime-agent:${AGENT_ID}`),
      configSha256: hash(GATEWAY_CONFIG)
    });
    expect(diagnostic).not.toContain(API_KEY);
    expect(diagnostic).not.toContain(AGENT_ID);
    expect(diagnostic).not.toContain("OPENCLAW_GATEWAY_TOKEN");
    expect(diagnostic).not.toContain(GATEWAY_CONFIG.slice(0, 40));
  });

  it("emits only a safe typed code when validation or the provider fails", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const fetchImplementation = vi.fn(
      async () => new Response(`provider leaked ${API_KEY}`, { status: 403 })
    );
    const exitCode = await runMaritimeOpenClawConfigUploadCli({
      argv: ["--confirm", AGENT_ID],
      environment: {
        MARITIME_API_KEY: API_KEY,
        VERA_MARITIME_GATEWAY_AGENT_ID: AGENT_ID
      },
      fetchImplementation,
      verifyConfigFiles: async () => [],
      correlationIdFactory: () => CORRELATION_ID,
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    });
    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(JSON.parse(stderr.join(""))).toEqual({
      event: "openclaw_config_upload_failed",
      code: "maritime_config_authentication_failed",
      retryable: false
    });
    expect(stderr.join("")).not.toContain(API_KEY);
    expect(stderr.join("")).not.toContain(AGENT_ID);
  });
});
