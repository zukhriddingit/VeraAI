import { spawn } from "node:child_process";

import { demoEnvironment } from "./demo-environment.ts";

const child = spawn("pnpm", ["dev"], {
  env: demoEnvironment(),
  stdio: "inherit"
});

function forward(signal: NodeJS.Signals): void {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.once("SIGINT", () => forward("SIGINT"));
process.once("SIGTERM", () => forward("SIGTERM"));
child.once("error", (error) => {
  process.stderr.write(`Unable to start Vera demo: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
