import { constants } from "node:fs";
import { access, chmod, link, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { inspectPublicGatewayImage } from "./gateway-registry-client.ts";
import { parseImmutableImageReference } from "./gateway-registry-contract.ts";
import { diffGatewayImages } from "./gateway-runtime-binding.ts";

const FIXED_REPOSITORY = "ghcr.io/zukhriddingit/vera-openclaw-gateway";

export interface GatewayRegistryArguments {
  readonly currentIndex: string;
  readonly previousIndex: string;
  readonly outputPath: string;
}

export interface GatewayRegistryComparison {
  readonly schemaVersion: 1;
  readonly current: Awaited<ReturnType<typeof inspectPublicGatewayImage>>;
  readonly previous: Awaited<ReturnType<typeof inspectPublicGatewayImage>>;
  readonly structuralDiff: ReturnType<typeof diffGatewayImages>;
}

export interface GatewayRegistryCommandDependencies {
  readonly inspect: typeof inspectPublicGatewayImage;
  readonly writeOutput: (path: string, value: GatewayRegistryComparison) => Promise<void>;
  readonly stdout: (value: string) => void;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function validateGatewayReference(value: string, label: string): void {
  const parsed = parseImmutableImageReference(value);
  if (`${parsed.registry}/${parsed.repository}` !== FIXED_REPOSITORY) {
    throw new Error(`${label} must use the approved public Gateway repository.`);
  }
}

export function parseGatewayRegistryArguments(
  argv: readonly string[],
  options: {
    readonly workspaceRoot?: string;
    readonly allowedOutputDirectory?: string;
  } = {}
): GatewayRegistryArguments {
  const normalizedArguments = argv[0] === "--" ? argv.slice(1) : argv;
  const values = new Map<string, string>();
  const allowed = new Set(["--current-index", "--previous-index", "--output"]);
  for (let index = 0; index < normalizedArguments.length; index += 2) {
    const option = normalizedArguments[index];
    const value = normalizedArguments[index + 1];
    if (!option || !allowed.has(option) || !value || value.startsWith("--")) {
      throw new Error("Gateway registry inspection arguments are invalid.");
    }
    if (values.has(option)) {
      throw new Error(`Gateway registry inspection option ${option} is duplicated.`);
    }
    values.set(option, value);
  }
  if (values.size !== 3 || normalizedArguments.length !== 6) {
    throw new Error("Current index, previous index, and output are required.");
  }
  const currentIndex = values.get("--current-index") as string;
  const previousIndex = values.get("--previous-index") as string;
  validateGatewayReference(currentIndex, "Current index");
  validateGatewayReference(previousIndex, "Previous index");
  if (currentIndex === previousIndex) {
    throw new Error("Current and previous Gateway indexes must be different.");
  }

  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const configuredDirectory = resolve(
    workspaceRoot,
    options.allowedOutputDirectory ??
      process.env.VERA_GATEWAY_REGISTRY_OUTPUT_DIRECTORY ??
      "release-evidence/private"
  );
  const outputPath = resolve(workspaceRoot, values.get("--output") as string);
  if (!isInside(configuredDirectory, outputPath)) {
    throw new Error("Gateway registry output must be below the configured evidence directory.");
  }
  return { currentIndex, previousIndex, outputPath };
}

export async function writeGatewayRegistryComparison(
  outputPath: string,
  value: GatewayRegistryComparison
): Promise<void> {
  const directory = dirname(outputPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  try {
    await access(outputPath, constants.F_OK);
    throw new Error("Gateway registry evidence output already exists.");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const temporaryPath = resolve(
    directory,
    `.${basename(outputPath)}.${process.pid.toString(10)}.tmp`
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await link(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function runGatewayRegistryInspection(
  args: GatewayRegistryArguments,
  dependencies: GatewayRegistryCommandDependencies = {
    inspect: inspectPublicGatewayImage,
    writeOutput: writeGatewayRegistryComparison,
    stdout: (value) => process.stdout.write(value)
  }
): Promise<GatewayRegistryComparison> {
  const [current, previous] = await Promise.all([
    dependencies.inspect({ imageRef: args.currentIndex }),
    dependencies.inspect({ imageRef: args.previousIndex })
  ]);
  if (
    current.releaseIndexDigest === current.runtimeManifestDigest ||
    previous.releaseIndexDigest === previous.runtimeManifestDigest
  ) {
    throw new Error("A release index and its selected runtime manifest must be distinct.");
  }
  if (
    current.runtimeDescriptor.digest !== current.runtimeManifestDigest ||
    previous.runtimeDescriptor.digest !== previous.runtimeManifestDigest
  ) {
    throw new Error("Inspected runtime manifest does not match its index descriptor.");
  }
  const comparison: GatewayRegistryComparison = {
    schemaVersion: 1,
    current,
    previous,
    structuralDiff: diffGatewayImages(previous, current)
  };
  await dependencies.writeOutput(args.outputPath, comparison);
  dependencies.stdout(
    `${JSON.stringify({
      outcome: "passed",
      runnablePlatformCount: current.runnablePlatformCount,
      attestationManifestCount: current.attestationManifestCount
    })}\n`
  );
  return comparison;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  runGatewayRegistryInspection(parseGatewayRegistryArguments(process.argv.slice(2))).catch(
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Gateway registry inspection failed."}\n`
      );
      process.exitCode = 1;
    }
  );
}
