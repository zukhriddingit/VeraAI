import { rmSync } from "node:fs";

import {
  productionDataDirectory,
  resolveDemoDataDirectory,
  validateDemoResetTarget
} from "./demo-environment.ts";

const target = validateDemoResetTarget(resolveDemoDataDirectory(), productionDataDirectory());

rmSync(target, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ event: "demo_reset_completed" })}\n`);
