import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CREATE_CONFIRMATION,
  DIGITALOCEAN_DROPLET_IMAGE,
  DIGITALOCEAN_DROPLET_SIZE,
  DIGITALOCEAN_REGION,
  parseOperatorIpv4,
  readMode0600File,
  requireDigitalOceanToken,
  resourceNames,
  writePrivateJsonExclusive
} from "./config.ts";
import type { PrivateStackManifest } from "./config.ts";
import { cleanupStack } from "./cleanup-stack.ts";
import type { CleanupClient } from "./cleanup-stack.ts";
import { DigitalOceanClient, waitForActiveDroplet } from "./digitalocean-api.ts";
import type { DigitalOceanDroplet } from "./digitalocean-api.ts";

export interface CreateStackClient extends CleanupClient {
  createTag(name: string): Promise<void>;
  createFirewall(input: {
    name: string;
    tag: string;
    operatorIpv4: string;
  }): Promise<{ id: string }>;
  createSshKey(input: { name: string; publicKey: string }): Promise<{ id: number }>;
  createDroplet(input: {
    name: string;
    region: string;
    size: string;
    image: string;
    tag: string;
    sshKeyId: number;
    userData: string;
  }): Promise<DigitalOceanDroplet>;
  getDroplet(id: number, acceptNotFound?: boolean): Promise<DigitalOceanDroplet | null>;
}

export interface CreateDiagnosticsStackInput {
  client: CreateStackClient;
  suffix: string;
  operatorIpv4: string;
  publicKey: string;
  cloudInit: string;
  manifestPath: string;
  now?: () => Date;
  waitForActive?: typeof waitForActiveDroplet;
}

function newManifest(suffix: string, now: () => Date): PrivateStackManifest {
  return {
    schemaVersion: 1,
    createdAtUtc: now().toISOString(),
    region: DIGITALOCEAN_REGION,
    names: resourceNames(suffix),
    resourceIds: {
      droplet: null,
      firewall: null,
      sshKey: null,
      loadBalancer: null,
      certificate: null,
      domainRecord: null
    },
    domain: null,
    publicIpv4: null,
    privateIpv4: null,
    cleanupRequired: true
  };
}

export async function createDiagnosticsStack(
  input: CreateDiagnosticsStackInput
): Promise<PrivateStackManifest> {
  const manifest = newManifest(input.suffix, input.now ?? (() => new Date()));
  const operatorIpv4 = parseOperatorIpv4(input.operatorIpv4);
  if (
    !input.publicKey.startsWith("ssh-ed25519 ") ||
    input.publicKey.includes("\n") ||
    input.publicKey.length > 1_024
  ) {
    throw new Error("ssh_public_key_rejected");
  }
  if (
    !input.cloudInit.startsWith("#cloud-config\n") ||
    Buffer.byteLength(input.cloudInit) > 65_536
  ) {
    throw new Error("rendered_cloud_init_rejected");
  }

  try {
    await input.client.createTag(manifest.names.tag);
    const firewall = await input.client.createFirewall({
      name: manifest.names.firewall,
      tag: manifest.names.tag,
      operatorIpv4
    });
    manifest.resourceIds.firewall = firewall.id;
    const sshKey = await input.client.createSshKey({
      name: manifest.names.sshKey,
      publicKey: input.publicKey
    });
    manifest.resourceIds.sshKey = sshKey.id;
    const droplet = await input.client.createDroplet({
      name: manifest.names.droplet,
      region: DIGITALOCEAN_REGION,
      size: DIGITALOCEAN_DROPLET_SIZE,
      image: DIGITALOCEAN_DROPLET_IMAGE,
      tag: manifest.names.tag,
      sshKeyId: sshKey.id,
      userData: input.cloudInit
    });
    manifest.resourceIds.droplet = droplet.id;
    const activeDroplet = await (input.waitForActive ?? waitForActiveDroplet)({
      client: input.client,
      dropletId: droplet.id
    });
    manifest.publicIpv4 =
      activeDroplet.networks.v4.find((network) => network.type === "public")?.ip_address ?? null;
    manifest.privateIpv4 =
      activeDroplet.networks.v4.find((network) => network.type === "private")?.ip_address ?? null;
    if (manifest.publicIpv4 === null || manifest.privateIpv4 === null) {
      throw new Error("droplet_networks_missing");
    }
    await writePrivateJsonExclusive(input.manifestPath, manifest);
    return manifest;
  } catch (error) {
    await cleanupStack({ client: input.client, manifest }).catch(() => undefined);
    throw error;
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) throw new Error(`missing_${name.slice(2)}`);
  return value;
}

async function main(): Promise<void> {
  if (argument("--confirm") !== CREATE_CONFIRMATION)
    throw new Error("create_confirmation_rejected");
  const cloudInitPath = resolve(argument("--cloud-init"));
  const publicKeyPath = resolve(argument("--ssh-public-key"));
  const cloudInit = await readMode0600File(cloudInitPath, "rendered_cloud_init");
  const publicKey = (await readMode0600File(publicKeyPath, "ssh_public_key")).trim();
  const token = requireDigitalOceanToken(process.env.VERA_DO_API_TOKEN);
  await createDiagnosticsStack({
    client: new DigitalOceanClient(token),
    suffix: argument("--suffix"),
    operatorIpv4: argument("--operator-ipv4"),
    publicKey,
    cloudInit,
    manifestPath: resolve(argument("--manifest"))
  });
  process.stdout.write("diagnostics_stack=active\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
