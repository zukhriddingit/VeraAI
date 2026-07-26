#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// These exports are pinned to the exact OpenClaw base-image digest verified by
// scripts/verify-remote-extension-config.ts. OpenClaw's deep security probe is
// deliberately non-mutating, so a trusted Gateway operator must establish the
// probe's read-only device baseline before collecting deep-audit evidence.
import {
  o as publicKeyRawBase64UrlFromPem,
  r as loadOrCreateDeviceIdentity
} from "/app/dist/device-identity-UW4cZXf5.js";
import {
  f as removePairedDevice,
  m as requestDevicePairing,
  n as approveDevicePairing
} from "/app/dist/device-pairing-Dw7KWdQ7.js";

const READ_ONLY_SCOPES = Object.freeze(["operator.read"]);
const stateDirectory = process.env.OPENCLAW_STATE_DIR;

if (!stateDirectory) {
  throw new Error("OPENCLAW_STATE_DIR is required.");
}

const identityDirectory = join(stateDirectory, "identity");
const tokenPath = join(identityDirectory, "device-auth.json");

function writePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function seed() {
  const identity = loadOrCreateDeviceIdentity();
  const pairing = await requestDevicePairing({
    deviceId: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    displayName: "Vera security audit probe",
    platform: process.platform,
    clientId: "vera-security-audit",
    clientMode: "probe",
    role: "operator",
    scopes: READ_ONLY_SCOPES,
    silent: true
  });
  const approved = await approveDevicePairing(pairing.request.requestId, {
    callerScopes: READ_ONLY_SCOPES
  });
  const token =
    approved?.status === "approved" ? approved.device.tokens?.operator?.token : undefined;

  if (!token) {
    throw new Error("OpenClaw did not issue the read-only audit device token.");
  }

  writePrivateJson(tokenPath, {
    version: 1,
    deviceId: identity.deviceId,
    tokens: {
      operator: {
        token,
        role: "operator",
        scopes: READ_ONLY_SCOPES,
        updatedAtMs: Date.now()
      }
    }
  });

  process.stdout.write(
    `${JSON.stringify({ status: "seeded", role: "operator", scopes: READ_ONLY_SCOPES })}\n`
  );
}

async function remove() {
  const identity = loadOrCreateDeviceIdentity();
  await removePairedDevice(identity.deviceId);
  rmSync(tokenPath, { force: true });
  process.stdout.write(
    `${JSON.stringify({ status: "removed", role: "operator", scopes: READ_ONLY_SCOPES })}\n`
  );
}

const operation = process.argv[2] ?? "seed";
if (operation === "seed") {
  await seed();
} else if (operation === "remove") {
  await remove();
} else {
  throw new Error('Expected operation "seed" or "remove".');
}
