import { runCli } from "./cli.js";

export * from "./lifecycle.js";
export * from "./logger.js";
export * from "./metrics.js";
export * from "./normalization-worker.js";
export * from "./acquisition-worker.js";
export * from "./decision-worker.js";
export * from "./decision-runtime.js";
export * from "./provider-factory.js";
export * from "./postgres-runtime.js";
export * from "./maritime-scheduler.js";
export * from "./service-server.js";
export * from "./runtime-config.js";
export * from "./notification-worker.js";
export * from "./gmail-alert-worker.js";
export * from "./google-gmail-access.js";
export * from "./health-reconciliation.js";

process.exitCode = await runCli(process.argv.slice(2));
