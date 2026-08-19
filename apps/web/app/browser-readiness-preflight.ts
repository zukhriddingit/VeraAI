import {
  browserExtensionReadyForResearch,
  type BrowserExtensionReadinessMessage
} from "@vera/domain";

export function browserReadinessObservationIsFresh(
  message: BrowserExtensionReadinessMessage | null,
  observedAt: number | null,
  preflightStartedAt: number
): boolean {
  return (
    observedAt !== null &&
    observedAt > preflightStartedAt &&
    browserExtensionReadyForResearch(message)
  );
}
