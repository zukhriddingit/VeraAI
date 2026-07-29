import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseOperatorIpv4,
  parseResourceSuffix,
  readCredentialPair,
  resourceNames,
  assertPrivateStackManifest,
  writePrivateJsonExclusive
} from "./config.ts";

const temporaryDirectories: string[] = [];

async function privateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vera-do-config-"));
  await chmod(directory, 0o700);
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  );
});

describe("DigitalOcean browser Gateway private configuration", () => {
  it("accepts two distinct lowercase-hex mode-0600 credentials", async () => {
    const directory = await privateDirectory();
    const gatewayTokenPath = join(directory, "gateway-token");
    const pairingSeedPath = join(directory, "pairing-seed");
    await writeFile(gatewayTokenPath, `${"a".repeat(64)}\n`, { mode: 0o600 });
    await writeFile(pairingSeedPath, `${"b".repeat(64)}\n`, { mode: 0o600 });

    await expect(readCredentialPair({ gatewayTokenPath, pairingSeedPath })).resolves.toEqual({
      gatewayToken: "a".repeat(64),
      pairingSeed: "b".repeat(64)
    });
  });

  it("rejects a group-readable credential", async () => {
    const directory = await privateDirectory();
    const gatewayTokenPath = join(directory, "gateway-token");
    const pairingSeedPath = join(directory, "pairing-seed");
    await writeFile(gatewayTokenPath, "a".repeat(64), { mode: 0o640 });
    await writeFile(pairingSeedPath, "b".repeat(64), { mode: 0o600 });

    await expect(readCredentialPair({ gatewayTokenPath, pairingSeedPath })).rejects.toThrow(
      "gateway_token_private_file_rejected"
    );
  });

  it("rejects a symbolic-link credential", async () => {
    const directory = await privateDirectory();
    const target = join(directory, "target");
    const gatewayTokenPath = join(directory, "gateway-token");
    const pairingSeedPath = join(directory, "pairing-seed");
    await writeFile(target, "a".repeat(64), { mode: 0o600 });
    await symlink(target, gatewayTokenPath);
    await writeFile(pairingSeedPath, "b".repeat(64), { mode: 0o600 });

    await expect(readCredentialPair({ gatewayTokenPath, pairingSeedPath })).rejects.toThrow(
      "gateway_token_private_file_rejected"
    );
  });

  it.each([
    ["A".repeat(64), "b".repeat(64)],
    ["a".repeat(63), "b".repeat(64)],
    ["a".repeat(64), "a".repeat(64)]
  ])("rejects malformed or reused credentials", async (gatewayToken, pairingSeed) => {
    const directory = await privateDirectory();
    const gatewayTokenPath = join(directory, "gateway-token");
    const pairingSeedPath = join(directory, "pairing-seed");
    await writeFile(gatewayTokenPath, gatewayToken, { mode: 0o600 });
    await writeFile(pairingSeedPath, pairingSeed, { mode: 0o600 });

    await expect(readCredentialPair({ gatewayTokenPath, pairingSeedPath })).rejects.toThrow(
      "credential_input_rejected"
    );
  });

  it("validates the exact operator IPv4 and resource suffix", () => {
    expect(parseOperatorIpv4("203.0.113.4")).toBe("203.0.113.4");
    expect(() => parseOperatorIpv4("0.0.0.0/0")).toThrow("operator_ipv4_rejected");
    expect(parseResourceSuffix("20260729-10")).toBe("20260729-10");
    expect(resourceNames("20260729-10")).toEqual({
      droplet: "vera-m13a-do-gateway-20260729-10",
      firewall: "vera-m13a-do-fw-20260729-10",
      tag: "vera-m13a-do-20260729-10",
      sshKey: "vera-m13a-do-20260729-10"
    });
  });

  it("writes a new private JSON file exclusively", async () => {
    const directory = await privateDirectory();
    const output = join(directory, "manifest.json");
    await writePrivateJsonExclusive(output, { status: "ready" });
    await expect(writePrivateJsonExclusive(output, { status: "overwritten" })).rejects.toThrow();
  });

  it("rejects a cleanup manifest whose resource names or identifiers escape the fixed run", () => {
    expect(() =>
      assertPrivateStackManifest({
        schemaVersion: 1,
        createdAtUtc: "2026-07-29T12:00:00Z",
        region: "nyc1",
        names: {
          droplet: "unrelated-production-droplet",
          firewall: "vera-m13a-do-fw-20260729-10",
          tag: "vera-m13a-do-20260729-10",
          sshKey: "vera-m13a-do-20260729-10"
        },
        resourceIds: {
          droplet: 1,
          firewall: "not-a-uuid",
          sshKey: 2,
          loadBalancer: null,
          certificate: null,
          domainRecord: null
        },
        domain: null,
        publicIpv4: null,
        privateIpv4: null,
        cleanupRequired: true
      })
    ).toThrow("private_stack_manifest_rejected");
  });
});
