import { runCli } from "./cli.js";

export * from "./lifecycle.js";
export * from "./logger.js";
export * from "./normalization-worker.js";
export * from "./decision-worker.js";
export * from "./decision-runtime.js";
export * from "./provider-factory.js";

process.exitCode = await runCli(process.argv.slice(2));
