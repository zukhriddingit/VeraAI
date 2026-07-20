import {
  createSqliteRepositories,
  openExistingDatabase,
  type VeraRepositories
} from "@vera/db/runtime";
import {
  CanonicalListingCollectionResponseSchema,
  type CanonicalListingCollectionResponse,
  type DemoStatusResponse
} from "@vera/domain";

import { isDemoMode } from "./demo-mode";
import { getDemoStatus } from "./demo-search-service";

export type CockpitInitialState =
  | {
      readonly kind: "ready";
      readonly demoMode: boolean;
      readonly demoStatus: DemoStatusResponse | null;
      readonly listingCollection: CanonicalListingCollectionResponse;
    }
  | {
      readonly kind: "unavailable";
      readonly demoMode: boolean;
      readonly message: string;
    };

export function projectCockpitInitialState(
  repositories: VeraRepositories,
  options: { readonly demoMode: boolean; readonly now?: () => Date }
): CockpitInitialState {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const demoStatus = options.demoMode ? getDemoStatus(repositories, options.now) : null;
  const listings =
    options.demoMode && demoStatus?.status === "not_run"
      ? []
      : repositories.canonicalListings.listSummaries();

  return {
    kind: "ready",
    demoMode: options.demoMode,
    demoStatus,
    listingCollection: CanonicalListingCollectionResponseSchema.parse({
      listings,
      count: listings.length,
      generatedAt
    })
  };
}

export function loadCockpitInitialState(): CockpitInitialState {
  const demoMode = isDemoMode();
  let connection: ReturnType<typeof openExistingDatabase> | null = null;
  try {
    connection = openExistingDatabase();
    return projectCockpitInitialState(createSqliteRepositories(connection), { demoMode });
  } catch {
    return {
      kind: "unavailable",
      demoMode,
      message: demoMode
        ? "Demo data is not ready. Run pnpm demo:reset and pnpm demo:seed."
        : "Local listing data is not ready. Run pnpm db:migrate and pnpm db:seed."
    };
  } finally {
    connection?.close();
  }
}
