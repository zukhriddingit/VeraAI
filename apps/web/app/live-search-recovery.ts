import type {
  RentalResearchSource,
  RentalResearchSourceState,
  RentalResearchSourceStatus
} from "@vera/domain";

const recoverableStates = new Set<RentalResearchSourceState>([
  "login_required",
  "browser_offline",
  "tab_required",
  "partial",
  "manual_action_required",
  "failed"
]);

export function rentalResearchRecoverySources(
  sources: readonly RentalResearchSourceStatus[]
): readonly RentalResearchSource[] {
  return sources
    .filter((source) => recoverableStates.has(source.state))
    .map(({ source }) => source);
}

export function rentalResearchRecoveryReady(
  sources: readonly RentalResearchSourceStatus[]
): boolean {
  return (
    rentalResearchRecoverySources(sources).length > 0 &&
    sources.every((source) => source.state !== "searching")
  );
}

export function rentalResearchRecoveryLabel(
  sources: readonly RentalResearchSourceStatus[]
): string {
  return sources.some((source) => source.manualAction !== null)
    ? "Continue search"
    : `Retry failed source${sources.length === 1 ? "" : "s"}`;
}
