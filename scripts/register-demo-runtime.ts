import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";

import { migrateDatabase, openExistingDatabase } from "../packages/db/src/demo/index.ts";

import { registerApplication } from "../apps/web/lib/server/application-registry.ts";
import { createDemoApplication } from "../apps/web/lib/server/demo-application.ts";

function validLaunchCapability(value: string | undefined): value is string {
  if (!value || !/^[a-f0-9]{64}$/u.test(value)) return false;
  const supplied = Buffer.from(value, "hex");
  const normalized = Buffer.from(value.toLowerCase(), "hex");
  return supplied.length === 32 && timingSafeEqual(supplied, normalized);
}

const capability = new URL(import.meta.url).searchParams.get("capability") ?? undefined;
delete process.env.VERA_DEMO_LAUNCH_TOKEN;

if (!validLaunchCapability(capability)) {
  throw new Error("The explicit Vera demo launch capability is missing or invalid.");
}

const dataDirectory = process.env.VERA_DATA_DIR?.trim();
if (!dataDirectory) throw new Error("The isolated Vera demo data directory is unavailable.");
const migrationsFolder = process.env.VERA_DEMO_MIGRATIONS_DIR?.trim();
if (!migrationsFolder) throw new Error("The Vera demo migration directory is unavailable.");

const connection = openExistingDatabase({ filePath: join(dataDirectory, "vera.sqlite") });
migrateDatabase(connection, { migrationsFolder });
registerApplication(createDemoApplication(connection));
