import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const RAILWAY_VOLUME_PATH = "/data";

export interface RailwayConfiguration {
  readonly dataDirectory: string;
  readonly port: number;
  readonly childEnvironment: NodeJS.ProcessEnv;
}

export interface RailwayEnvironmentOptions {
  readonly expectedMountPath?: string;
  readonly assertDirectory?: (path: string) => void;
  readonly assertReadableWritable?: (path: string) => void;
}

function defaultAssertDirectory(path: string): void {
  if (!statSync(path).isDirectory()) {
    throw new Error("not-directory");
  }
}

function defaultAssertReadableWritable(path: string): void {
  accessSync(path, constants.R_OK | constants.W_OK);
}

export function resolveRailwayConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  options: RailwayEnvironmentOptions = {}
): RailwayConfiguration {
  const rawMountPath = environment.RAILWAY_VOLUME_MOUNT_PATH?.trim();

  if (!rawMountPath) {
    throw new Error("Railway volume mount is required.");
  }

  if (!isAbsolute(rawMountPath)) {
    throw new Error("Railway volume mount must be absolute.");
  }

  const expectedMountPath = resolve(options.expectedMountPath ?? RAILWAY_VOLUME_PATH);
  const dataDirectory = resolve(rawMountPath);

  if (dataDirectory !== expectedMountPath) {
    throw new Error(`Railway volume must be mounted at ${RAILWAY_VOLUME_PATH}.`);
  }

  try {
    (options.assertDirectory ?? defaultAssertDirectory)(dataDirectory);
    (options.assertReadableWritable ?? defaultAssertReadableWritable)(dataDirectory);
  } catch {
    throw new Error("Railway volume is unavailable or not writable.");
  }

  const rawPort = environment.PORT?.trim() ?? "";

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("Railway PORT must be an integer between 1 and 65535.");
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Railway PORT must be an integer between 1 and 65535.");
  }

  const childEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    VERA_DATA_DIR: dataDirectory,
    VERA_DEMO_MODE: "1",
    NEXT_TELEMETRY_DISABLED: "1"
  };

  delete childEnvironment.OPENAI_API_KEY;
  delete childEnvironment.VERA_LLM_MODEL;
  delete childEnvironment.VERA_LLM_TIMEOUT_MS;
  delete childEnvironment.VERA_DEMO_DATA_DIR;

  return {
    childEnvironment,
    dataDirectory,
    port
  };
}
