import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { getDataDirectory } from "../packages/db/src/demo/index.ts";

function withoutConfiguredDataDirectory(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...environment };
  delete copy.VERA_DATA_DIR;
  return copy;
}

export function productionDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = homedir()
): string {
  return getDataDirectory({
    environment: withoutConfiguredDataDirectory(environment),
    platform,
    homeDirectory
  });
}

export function resolveDemoDataDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = homedir()
): string {
  const override = environment.VERA_DEMO_DATA_DIR?.trim();

  if (override) {
    return resolve(override);
  }

  const production = productionDataDirectory(environment, platform, homeDirectory);
  return join(dirname(production), platform === "linux" ? "vera-demo" : "Vera Demo");
}

function isSameOrAncestor(candidate: string, protectedPath: string): boolean {
  const difference = relative(candidate, protectedPath);
  return difference === "" || !difference.startsWith("..");
}

export function validateDemoResetTarget(
  targetInput: string,
  productionInput: string,
  options: { homeDirectory?: string; workingDirectory?: string } = {}
): string {
  const target = resolve(targetInput);
  const protectedPaths = [
    resolve("/"),
    resolve(options.homeDirectory ?? homedir()),
    resolve(options.workingDirectory ?? process.cwd()),
    resolve(productionInput)
  ];

  if (protectedPaths.some((protectedPath) => isSameOrAncestor(target, protectedPath))) {
    throw new Error("Unsafe demo reset target.");
  }

  return target;
}

export function demoEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...base,
    VERA_DEMO_MODE: "1",
    VERA_DATA_DIR: resolveDemoDataDirectory(base),
    VERA_PUBLIC_BASE_URL: "http://127.0.0.1:3000",
    NEXT_TELEMETRY_DISABLED: "1"
  };

  delete environment.OPENAI_API_KEY;
  delete environment.VERA_LLM_MODEL;
  delete environment.VERA_LLM_TIMEOUT_MS;

  return environment;
}
