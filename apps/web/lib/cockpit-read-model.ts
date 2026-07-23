import type { UserRepositories } from "@vera/db";
import {
  CanonicalListingCollectionResponseSchema,
  type CanonicalListingCollectionResponse,
  type DemoStatusResponse
} from "@vera/domain";

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

export async function projectCockpitInitialState(
  repositories: UserRepositories,
  options: { readonly demoMode: boolean; readonly now?: () => Date }
): Promise<CockpitInitialState> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const demoStatus = options.demoMode ? await getDemoStatus(repositories, options.now) : null;
  const listings =
    options.demoMode && demoStatus?.status === "not_run"
      ? []
      : await repositories.canonicalListings.listSummaries();

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

export async function loadCockpitInitialState(
  repositories: UserRepositories,
  demoMode: boolean
): Promise<CockpitInitialState> {
  try {
    return await projectCockpitInitialState(repositories, { demoMode });
  } catch {
    return {
      kind: "unavailable",
      demoMode,
      message: demoMode
        ? "Demo data is not ready. Run pnpm demo:reset and pnpm demo:seed."
        : "Hosted listing data is unavailable. Check PostgreSQL readiness."
    };
  }
}
