import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  GATEWAY_TOKEN_PLACEHOLDER,
  PAIRING_SEED_PLACEHOLDER,
  PRIVATE_FILE_MODE,
  readCredentialPair
} from "./config.ts";

export interface RenderCloudInitInput {
  templatePath: string;
  gatewayTokenPath: string;
  pairingSeedPath: string;
  outputPath: string;
}

function replaceExactlyOnce(source: string, marker: string, value: string): string {
  const first = source.indexOf(marker);
  if (first < 0 || source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error("cloud_init_placeholder_count_rejected");
  }
  return `${source.slice(0, first)}${value}${source.slice(first + marker.length)}`;
}

export async function renderCloudInit(input: RenderCloudInitInput): Promise<void> {
  const templatePath = resolve(input.templatePath);
  const templateStat = await lstat(templatePath);
  if (!templateStat.isFile() || templateStat.isSymbolicLink()) {
    throw new Error("cloud_init_template_rejected");
  }

  const { gatewayToken, pairingSeed } = await readCredentialPair(input);
  const template = await readFile(templatePath, "utf8");
  let rendered = replaceExactlyOnce(template, GATEWAY_TOKEN_PLACEHOLDER, gatewayToken);
  rendered = replaceExactlyOnce(rendered, PAIRING_SEED_PLACEHOLDER, pairingSeed);
  if (rendered.includes("__VERA_")) throw new Error("cloud_init_unresolved_marker_rejected");
  if (Buffer.byteLength(rendered, "utf8") > 65_536) {
    throw new Error("cloud_init_size_rejected");
  }

  const outputPath = resolve(input.outputPath);
  const outputDirectory = await lstat(dirname(outputPath));
  if (
    !outputDirectory.isDirectory() ||
    outputDirectory.isSymbolicLink() ||
    (outputDirectory.mode & 0o077) !== 0
  ) {
    throw new Error("cloud_init_output_directory_rejected");
  }

  const handle = await open(
    outputPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE
  );
  try {
    await handle.writeFile(rendered, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value === undefined || value.startsWith("--")) throw new Error(`missing_${name.slice(2)}`);
  return value;
}

async function main(): Promise<void> {
  await renderCloudInit({
    templatePath: argument("--template"),
    gatewayTokenPath: argument("--gateway-token-file"),
    pairingSeedPath: argument("--pairing-seed-file"),
    outputPath: argument("--output")
  });
  process.stdout.write("rendered_cloud_init=ready\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  await main();
}
