import { rmSync } from "node:fs";
import { join } from "node:path";

const e2eDataDirectory = join(process.cwd(), "test-results", "vera-e2e-data");

rmSync(e2eDataDirectory, { recursive: true, force: true });
