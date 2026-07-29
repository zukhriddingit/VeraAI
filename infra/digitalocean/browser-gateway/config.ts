import { timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { dirname, resolve } from "node:path";

export const DIGITALOCEAN_API_BASE_URL = "https://api.digitalocean.com/v2";
export const DIGITALOCEAN_REGION = "nyc1";
export const DIGITALOCEAN_DROPLET_IMAGE = "ubuntu-24-04-x64";
export const DIGITALOCEAN_DROPLET_SIZE = "s-1vcpu-2gb";
export const GATEWAY_IMAGE =
  "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd";
export const GATEWAY_SOURCE_REVISION = "f155bca09d57017ac141d2c8f3eebd26657aeb3d";
export const GATEWAY_TOKEN_PLACEHOLDER = "__VERA_GATEWAY_TOKEN__";
export const PAIRING_SEED_PLACEHOLDER = "__VERA_EXTENSION_PAIRING_SEED__";
export const CREATE_CONFIRMATION = "create-one-disposable-gateway";
export const PRIVATE_FILE_MODE = 0o600;

const HEX_CREDENTIAL = /^[0-9a-f]{64}$/u;
const RESOURCE_SUFFIX = /^[0-9]{8}-[0-9]{2}$/u;

export interface CredentialPair {
  gatewayToken: string;
  pairingSeed: string;
}

export interface PrivateStackManifest {
  schemaVersion: 1;
  createdAtUtc: string;
  region: typeof DIGITALOCEAN_REGION;
  names: {
    droplet: string;
    firewall: string;
    tag: string;
    sshKey: string;
  };
  resourceIds: {
    droplet: number | null;
    firewall: string | null;
    sshKey: number | null;
    loadBalancer: string | null;
    certificate: string | null;
    domainRecord: number | null;
  };
  domain: string | null;
  publicIpv4: string | null;
  privateIpv4: string | null;
  cleanupRequired: boolean;
}

function credentialBytes(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

export async function readMode0600File(path: string, label: string): Promise<string> {
  const absolutePath = resolve(path);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new Error(`${label}_private_file_rejected`);
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(`${label}_private_file_owner_rejected`);
  }
  return await readFile(absolutePath, "utf8");
}

export async function readCredentialPair(input: {
  gatewayTokenPath: string;
  pairingSeedPath: string;
}): Promise<CredentialPair> {
  const gatewayToken = (await readMode0600File(input.gatewayTokenPath, "gateway_token")).trim();
  const pairingSeed = (await readMode0600File(input.pairingSeedPath, "pairing_seed")).trim();
  if (!HEX_CREDENTIAL.test(gatewayToken) || !HEX_CREDENTIAL.test(pairingSeed)) {
    throw new Error("credential_input_rejected");
  }
  if (timingSafeEqual(credentialBytes(gatewayToken), credentialBytes(pairingSeed))) {
    throw new Error("credential_input_rejected");
  }
  return { gatewayToken, pairingSeed };
}

export function parseOperatorIpv4(value: string): string {
  const normalized = value.trim();
  if (!isIPv4(normalized)) throw new Error("operator_ipv4_rejected");
  return normalized;
}

export function parseResourceSuffix(value: string): string {
  const normalized = value.trim();
  if (!RESOURCE_SUFFIX.test(normalized)) throw new Error("resource_suffix_rejected");
  return normalized;
}

export function requireDigitalOceanToken(value: string | undefined): string {
  if (value === undefined || value.length < 32 || value.length > 256 || /[\s\r\n]/u.test(value)) {
    throw new Error("digitalocean_token_rejected");
  }
  return value;
}

export function resourceNames(suffix: string): PrivateStackManifest["names"] {
  const safeSuffix = parseResourceSuffix(suffix);
  return {
    droplet: `vera-m13a-do-gateway-${safeSuffix}`,
    firewall: `vera-m13a-do-fw-${safeSuffix}`,
    tag: `vera-m13a-do-${safeSuffix}`,
    sshKey: `vera-m13a-do-${safeSuffix}`
  };
}

export async function writePrivateJsonExclusive(outputPath: string, value: unknown): Promise<void> {
  const absolutePath = resolve(outputPath);
  const directoryStat = await lstat(dirname(absolutePath));
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("private_output_directory_rejected");
  }
  if ((directoryStat.mode & 0o077) !== 0) {
    throw new Error("private_output_directory_mode_rejected");
  }
  const handle = await open(
    absolutePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function assertPrivateStackManifest(value: unknown): asserts value is PrivateStackManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("private_stack_manifest_rejected");
  }
  const candidate = value as Partial<PrivateStackManifest>;
  const candidateNames =
    typeof candidate.names === "object" && candidate.names !== null ? candidate.names : null;
  const candidateResourceIds =
    typeof candidate.resourceIds === "object" && candidate.resourceIds !== null
      ? candidate.resourceIds
      : null;
  const exactKeys = (input: object | null, expected: readonly string[]): boolean => {
    if (input === null) return false;
    const actual = Object.keys(input).sort();
    const sortedExpected = [...expected].sort();
    return (
      actual.length === sortedExpected.length &&
      actual.every((key, index) => key === sortedExpected[index])
    );
  };
  const positiveIntegerOrNull = (input: unknown): boolean =>
    input === null || (Number.isSafeInteger(input) && (input as number) > 0);
  const uuidOrNull = (input: unknown): boolean =>
    input === null ||
    (typeof input === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input));
  const dropletName =
    candidateNames === null || typeof candidateNames.droplet !== "string"
      ? ""
      : candidateNames.droplet;
  const suffix = dropletName.match(/^vera-m13a-do-gateway-([0-9]{8}-[0-9]{2})$/u)?.[1];
  if (
    !exactKeys(candidate, [
      "schemaVersion",
      "createdAtUtc",
      "region",
      "names",
      "resourceIds",
      "domain",
      "publicIpv4",
      "privateIpv4",
      "cleanupRequired"
    ]) ||
    candidate.schemaVersion !== 1 ||
    candidate.region !== DIGITALOCEAN_REGION ||
    typeof candidate.createdAtUtc !== "string" ||
    Number.isNaN(Date.parse(candidate.createdAtUtc)) ||
    candidate.cleanupRequired !== true ||
    !exactKeys(candidateNames, ["droplet", "firewall", "tag", "sshKey"]) ||
    suffix === undefined ||
    candidateNames?.firewall !== `vera-m13a-do-fw-${suffix}` ||
    candidateNames?.tag !== `vera-m13a-do-${suffix}` ||
    candidateNames?.sshKey !== `vera-m13a-do-${suffix}` ||
    !exactKeys(candidateResourceIds, [
      "droplet",
      "firewall",
      "sshKey",
      "loadBalancer",
      "certificate",
      "domainRecord"
    ]) ||
    !positiveIntegerOrNull(candidateResourceIds?.droplet) ||
    !uuidOrNull(candidateResourceIds?.firewall) ||
    !positiveIntegerOrNull(candidateResourceIds?.sshKey) ||
    !uuidOrNull(candidateResourceIds?.loadBalancer) ||
    !uuidOrNull(candidateResourceIds?.certificate) ||
    !positiveIntegerOrNull(candidateResourceIds?.domainRecord) ||
    !(
      candidate.domain === null ||
      (typeof candidate.domain === "string" &&
        /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(candidate.domain))
    ) ||
    !(
      candidate.publicIpv4 === null ||
      (typeof candidate.publicIpv4 === "string" && isIPv4(candidate.publicIpv4))
    ) ||
    !(
      candidate.privateIpv4 === null ||
      (typeof candidate.privateIpv4 === "string" && isIPv4(candidate.privateIpv4))
    )
  ) {
    throw new Error("private_stack_manifest_rejected");
  }
}
