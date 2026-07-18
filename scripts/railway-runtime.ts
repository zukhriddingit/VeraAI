import { spawn, type SpawnOptions } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type SeedResult
} from "../packages/db/src/index.ts";
import { resolveRailwayConfiguration, type RailwayConfiguration } from "./railway-environment.ts";

const defaultRootDirectory = fileURLToPath(new URL("../", import.meta.url));

export interface ManagedRailwayProcess {
  readonly killed: boolean;
  kill(signal: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export interface RailwaySignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface RailwayLogger {
  info(record: Readonly<Record<string, unknown>>): void;
  error(record: Readonly<Record<string, unknown>>): void;
}

export interface NamedRailwayProcess {
  readonly name: "web" | "worker";
  readonly process: ManagedRailwayProcess;
}

export interface RailwayDatabaseOptions {
  readonly rootDirectory?: string;
}

const defaultLogger: RailwayLogger = {
  info(record) {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
  error(record) {
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }
};

export function initializeRailwayDatabase(
  configuration: RailwayConfiguration,
  options: RailwayDatabaseOptions = {}
): SeedResult {
  const rootDirectory = options.rootDirectory ?? defaultRootDirectory;
  const connection = openDatabase({
    filePath: join(configuration.dataDirectory, "vera.sqlite")
  });

  try {
    migrateDatabase(connection, {
      migrationsFolder: join(rootDirectory, "packages/db/drizzle")
    });
    return seedDatabase(createSqliteRepositories(connection));
  } finally {
    connection.close();
  }
}

export function superviseRailwayProcesses(
  children: readonly NamedRailwayProcess[],
  signalSource: RailwaySignalSource = process,
  logger: RailwayLogger = defaultLogger
): Promise<number> {
  if (children.length === 0) {
    throw new Error("Railway supervisor requires at least one child process.");
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (
      exitCode: number,
      record: Readonly<Record<string, unknown>>,
      terminationSignal: NodeJS.Signals
    ): void => {
      if (settled) return;
      settled = true;
      signalSource.off("SIGINT", onSigint);
      signalSource.off("SIGTERM", onSigterm);

      for (const child of children) {
        if (!child.process.killed) {
          child.process.kill(terminationSignal);
        }
      }

      if (exitCode === 0) {
        logger.info(record);
      } else {
        logger.error(record);
      }
      resolve(exitCode);
    };

    const onSigint = (): void => {
      finish(0, { event: "railway_shutdown_requested", signal: "SIGINT" }, "SIGINT");
    };
    const onSigterm = (): void => {
      finish(0, { event: "railway_shutdown_requested", signal: "SIGTERM" }, "SIGTERM");
    };

    signalSource.once("SIGINT", onSigint);
    signalSource.once("SIGTERM", onSigterm);

    for (const child of children) {
      child.process.once("error", () => {
        finish(1, { event: `${child.name}_process_error` }, "SIGTERM");
      });
      child.process.once("exit", () => {
        finish(1, { event: `${child.name}_process_exited` }, "SIGTERM");
      });
    }
  });
}

export async function runRailwayDeployment(): Promise<number> {
  const configuration = resolveRailwayConfiguration();
  const seedResult = initializeRailwayDatabase(configuration);
  defaultLogger.info({ event: "railway_database_ready", ...seedResult });

  const commonOptions: SpawnOptions = {
    cwd: defaultRootDirectory,
    env: configuration.childEnvironment,
    stdio: "inherit"
  };
  const worker = spawn(
    process.execPath,
    [join(defaultRootDirectory, "apps/worker/dist/index.js")],
    commonOptions
  );
  const web = spawn(
    process.execPath,
    [
      join(defaultRootDirectory, "apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "0.0.0.0",
      "--port",
      String(configuration.port)
    ],
    commonOptions
  );

  return superviseRailwayProcesses([
    { name: "worker", process: worker },
    { name: "web", process: web }
  ]);
}
