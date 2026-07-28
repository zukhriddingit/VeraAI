import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface StartupMemoryMeasurement {
  readonly rssBeforeMb: number;
  readonly rssAfterMb: number;
  readonly rssDeltaMb: number;
  readonly heapUsedBeforeMb: number;
  readonly heapUsedAfterMb: number;
  readonly heapUsedDeltaMb: number;
}

type MemoryReader = () => Pick<NodeJS.MemoryUsage, "rss" | "heapUsed">;

function mebibytes(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 10) / 10;
}

export async function measureImportedModuleMemory(
  importModule: () => Promise<unknown>,
  readMemory: MemoryReader = process.memoryUsage
): Promise<StartupMemoryMeasurement> {
  const before = readMemory();
  await importModule();
  const after = readMemory();
  return {
    rssBeforeMb: mebibytes(before.rss),
    rssAfterMb: mebibytes(after.rss),
    rssDeltaMb: mebibytes(Math.max(0, after.rss - before.rss)),
    heapUsedBeforeMb: mebibytes(before.heapUsed),
    heapUsedAfterMb: mebibytes(after.heapUsed),
    heapUsedDeltaMb: mebibytes(Math.max(0, after.heapUsed - before.heapUsed))
  };
}

async function run(): Promise<void> {
  const measurement = await measureImportedModuleMemory(
    () => import("../apps/web/lib/server/application.ts")
  );
  process.stdout.write(`${JSON.stringify(measurement)}\n`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) {
  void run().catch(() => {
    process.stderr.write("Web startup memory diagnostic failed safely.\n");
    process.exitCode = 1;
  });
}
