import { runRailwayDeployment } from "./railway-runtime.ts";

try {
  process.exitCode = await runRailwayDeployment();
} catch (error: unknown) {
  process.stderr.write(
    `${JSON.stringify({
      event: "railway_start_failed",
      errorType: error instanceof Error ? error.name : "UnknownError"
    })}\n`
  );
  process.exitCode = 1;
}
