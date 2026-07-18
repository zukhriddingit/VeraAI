import {
  createSqliteRepositories,
  openExistingDatabase,
  type VeraDatabaseConnection
} from "@vera/db/runtime";
import {
  CanonicalListingCollectionResponseSchema,
  ListingsUnavailableResponseSchema
} from "@vera/domain";

import { isDemoMode } from "../../../lib/demo-mode";
import { getDemoStatus } from "../../../lib/demo-search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
};

export async function GET(): Promise<Response> {
  const generatedAt = new Date().toISOString();
  let connection: VeraDatabaseConnection | null = null;

  try {
    connection = openExistingDatabase();
    const repositories = createSqliteRepositories(connection);
    const listings =
      isDemoMode() && getDemoStatus(repositories).status === "not_run"
        ? []
        : repositories.canonicalListings.listSummaries();
    const response = CanonicalListingCollectionResponseSchema.parse({
      listings,
      count: listings.length,
      generatedAt
    });

    return Response.json(response, { status: 200, headers });
  } catch {
    const response = ListingsUnavailableResponseSchema.parse({
      code: "database_unavailable",
      message: isDemoMode()
        ? "Demo listing data is unavailable. Run pnpm demo:reset and pnpm demo:seed."
        : "Local listing data is unavailable. Run pnpm db:migrate and pnpm db:seed.",
      generatedAt
    });

    return Response.json(response, { status: 503, headers });
  } finally {
    connection?.close();
  }
}
