import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  DEMO_USER_ID,
  createDemoRepositoryProvider,
  openExistingDatabase
} from "../packages/db/src/demo/index.ts";
import { createAlternatingWorkerRuntime } from "../apps/worker/src/decision-runtime.ts";
import { processNextDecisionJob } from "../apps/worker/src/decision-worker.ts";
import { processNextNormalizationJob } from "../apps/worker/src/normalization-worker.ts";

const dataDirectory = process.env.VERA_DATA_DIR?.trim();
if (!dataDirectory) throw new Error("The isolated Vera demo data directory is unavailable.");

const connection = openExistingDatabase({ filePath: join(dataDirectory, "vera.sqlite") });
const repositoryProvider = createDemoRepositoryProvider(connection);
const repositories = repositoryProvider.forUser(DEMO_USER_ID);
const leaseOwner = `demo-worker:${randomUUID()}`;
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | null = null;

const runtime = createAlternatingWorkerRuntime({
  processNormalization: (signal) =>
    processNextNormalizationJob(
      {
        userId: DEMO_USER_ID,
        repositoryProvider,
        repositories,
        leaseOwner,
        provider: null,
        now: () => new Date(),
        createId: randomUUID
      },
      signal
    ),
  processDecision: (signal) =>
    processNextDecisionJob(
      {
        userId: DEMO_USER_ID,
        repositoryProvider,
        repositories,
        leaseOwner,
        now: () => new Date(),
        createId: randomUUID
      },
      signal
    )
});

async function poll(): Promise<void> {
  if (controller.signal.aborted) return;
  try {
    await runtime.processNext(controller.signal);
  } catch {
    // The persisted job state remains authoritative; the next bounded poll retries safely.
  }
  if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 250);
}

function shutdown(): void {
  controller.abort();
  if (timer) clearTimeout(timer);
  connection.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
void poll();
