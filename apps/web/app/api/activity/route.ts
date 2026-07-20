import { createSqliteRepositories, openExistingDatabase } from "@vera/db/runtime";
import { DemoUnavailableResponseSchema } from "@vera/domain";

import { getActivityCollection } from "../../../lib/listing-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(): Promise<Response> {
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    connection = openExistingDatabase();
    return Response.json(getActivityCollection(createSqliteRepositories(connection)), {
      status: 200,
      headers
    });
  } catch {
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: "demo_unavailable",
        message: "Activity history is unavailable."
      }),
      { status: 503, headers }
    );
  } finally {
    connection?.close();
  }
}
