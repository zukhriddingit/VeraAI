import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { demoEnvironment } from "./demo-environment.ts";

const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const registerScript = fileURLToPath(new URL("./register-demo-runtime.ts", import.meta.url));
const webDirectory = fileURLToPath(new URL("../apps/web/", import.meta.url));
const nextCli = fileURLToPath(
  new URL("../apps/web/node_modules/next/dist/bin/next", import.meta.url)
);
const demoWorker = fileURLToPath(new URL("./demo-worker.ts", import.meta.url));
const environment = demoEnvironment();
environment.VERA_DEMO_MIGRATIONS_DIR = fileURLToPath(
  new URL("../packages/db/drizzle-demo/", import.meta.url)
);
delete environment.VERA_DEMO_LAUNCH_TOKEN;
const bundledRegistration = fileURLToPath(
  new URL("../packages/db/node_modules/.cache/vera-demo-runtime-preload.mjs", import.meta.url)
);
await build({
  entryPoints: [registerScript],
  outfile: bundledRegistration,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  plugins: [
    {
      name: "externalize-third-party-runtime",
      setup(esbuild) {
        esbuild.onResolve({ filter: /^[^./]/ }, (arguments_) => {
          if (arguments_.path.startsWith("@vera/")) return null;
          if (arguments_.path.startsWith("node:")) {
            return { path: arguments_.path, external: true };
          }
          return {
            path: require.resolve(arguments_.path, {
              paths: [arguments_.importer ? dirname(arguments_.importer) : process.cwd()]
            }),
            external: true
          };
        });
      }
    }
  ],
  logLevel: "silent"
});
const registerUrl = pathToFileURL(bundledRegistration);
registerUrl.searchParams.set("capability", randomBytes(32).toString("hex"));
environment.NODE_OPTIONS = [environment.NODE_OPTIONS, `--import=${registerUrl.href}`]
  .filter(Boolean)
  .join(" ");

const web = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1"], {
  cwd: webDirectory,
  env: environment,
  stdio: "inherit"
});
const workerEnvironment = { ...environment };
delete workerEnvironment.NODE_OPTIONS;
const worker = spawn(process.execPath, [tsxCli, demoWorker], {
  cwd: process.cwd(),
  env: workerEnvironment,
  stdio: "inherit"
});

const children = [web, worker];
let settled = false;

function forward(signal: NodeJS.Signals): void {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.once("SIGINT", () => forward("SIGINT"));
process.once("SIGTERM", () => forward("SIGTERM"));
for (const child of children) {
  child.once("error", (error) => {
    process.stderr.write(`Unable to start Vera demo: ${error.message}\n`);
    forward("SIGTERM");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (settled) return;
    settled = true;
    forward("SIGTERM");
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
