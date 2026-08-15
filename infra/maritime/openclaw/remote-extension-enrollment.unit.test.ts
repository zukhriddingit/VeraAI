import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// Plain ESM is intentional because this exact source is copied into the Gateway image.
// @ts-expect-error The runtime module has no generated declaration file.
import {
  ENROLLMENT_PROTOCOL,
  parseCheckpointDecision,
  parseEnrollmentFrame,
  readRelayCredential,
  resolveEnrollmentConfiguration
} from "./remote-extension-enrollment.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("remote extension enrollment boundary", () => {
  it("requires every exact fail-closed environment binding", () => {
    const environment = {
      VERA_BROWSER_ENROLLMENT_ENABLED: "1",
      VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL:
        "https://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint",
      VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN: "https://gateway-a.verahousing.app",
      VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN: "a".repeat(64)
    };
    expect(resolveEnrollmentConfiguration(environment)).toEqual({
      checkpointUrl: environment.VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL,
      publicGatewayOrigin: environment.VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN,
      checkpointToken: environment.VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN
    });
    expect(
      resolveEnrollmentConfiguration({ ...environment, VERA_BROWSER_ENROLLMENT_ENABLED: "0" })
    ).toBeNull();
    expect(
      resolveEnrollmentConfiguration({
        ...environment,
        VERA_BROWSER_ENROLLMENT_CHECKPOINT_URL:
          "http://app.verahousing.app/api/internal/browser-connector/enrollment/checkpoint"
      })
    ).toBeNull();
    expect(
      resolveEnrollmentConfiguration({
        ...environment,
        VERA_BROWSER_PUBLIC_GATEWAY_ORIGIN: "https://gateway-a.verahousing.app/path"
      })
    ).toBeNull();
    expect(
      resolveEnrollmentConfiguration({
        ...environment,
        VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN: "short"
      })
    ).toBeNull();
  });

  it("accepts only closed enrollment and checkpoint frames", () => {
    const frame = {
      ticket: "A".repeat(43),
      extensionVersion: "2.2.0",
      protocolVersion: "1",
      installationId: "b".repeat(64),
      requestedAt: "2026-08-14T12:00:10.000Z"
    };
    expect(parseEnrollmentFrame(frame)).toEqual(frame);
    expect(() => parseEnrollmentFrame({ ...frame, selector: "body" })).toThrow();
    expect(
      parseCheckpointDecision({
        allowed: true,
        assignmentId: "10000000-0000-4000-8000-000000000013"
      })
    ).toEqual({
      allowed: true,
      assignmentId: "10000000-0000-4000-8000-000000000013"
    });
    expect(() =>
      parseCheckpointDecision({
        allowed: true,
        assignmentId: "10000000-0000-4000-8000-000000000013",
        token: "c".repeat(64)
      })
    ).toThrow();
    expect(ENROLLMENT_PROTOCOL).toBe("vera-browser-enrollment.v1");
  });

  it("reads only an exact regular 0600 64-hex credential file", () => {
    const directory = mkdtempSync(join(tmpdir(), "vera-enrollment-credential-"));
    temporaryDirectories.push(directory);
    const credentialPath = join(directory, "relay.secret");
    const credential = "d".repeat(64);
    writeFileSync(credentialPath, credential, { mode: 0o600 });
    chmodSync(credentialPath, 0o600);

    expect(readRelayCredential(credentialPath)).toBe(credential);
    chmodSync(credentialPath, 0o644);
    expect(() => readRelayCredential(credentialPath)).toThrow(
      "Browser Connector relay credential is unavailable."
    );
    chmodSync(credentialPath, 0o600);
    const linkPath = join(directory, "relay-link.secret");
    symlinkSync(credentialPath, linkPath);
    expect(() => readRelayCredential(linkPath)).toThrow(
      "Browser Connector relay credential is unavailable."
    );
  });
});
