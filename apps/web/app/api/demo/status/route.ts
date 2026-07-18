import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import { DemoUnavailableResponseSchema } from "@vera/domain";

import { isDemoMode } from "../../../../lib/demo-mode";
import { DemoSearchStateError, getDemoStatus } from "../../../../lib/demo-search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(): Promise<Response> {
  if (!isDemoMode()) {
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: "demo_mode_disabled",
        message: "Demo mode is not enabled."
      }),
      { status: 404, headers }
    );
  }

  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    connection = openExistingDatabase();
    return Response.json(getDemoStatus(createSqliteRepositories(connection)), {
      status: 200,
      headers
    });
  } catch (error: unknown) {
    const invalid = error instanceof DemoSearchStateError;
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: invalid ? "demo_state_invalid" : "demo_unavailable",
        message: invalid
          ? error.message
          : "Demo data is unavailable. Run pnpm demo:reset and pnpm demo:seed."
      }),
      { status: invalid ? 409 : 503, headers }
    );
  } finally {
    connection?.close();
  }
}
