import { openDatabase } from "@vera/db/demo";

import {
  clearApplicationForTesting,
  registerApplication
} from "../lib/server/application-registry.ts";
import { createDemoApplication } from "../lib/server/demo-application.ts";

export function registerTestDemoRuntime(filePath: string) {
  clearApplicationForTesting();
  const connection = openDatabase({ filePath });
  registerApplication(createDemoApplication(connection));
  return connection;
}

export function clearTestApplication(): void {
  clearApplicationForTesting();
}
