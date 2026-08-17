import { PRIVACY_DELETION_CONFIRMATION } from "@vera/domain";

export type PrivacyControlsPhase =
  "idle" | "requesting_challenge" | "confirm" | "deleting" | "deleted" | "error";

export interface PrivacyControlsViewInput {
  readonly phase: PrivacyControlsPhase;
  readonly typedConfirmation: string;
  readonly hasChallenge?: boolean;
}

export interface PrivacyControlsView {
  readonly exportDisabled: boolean;
  readonly requestDeletionDisabled: boolean;
  readonly confirmDeletionVisible: boolean;
  readonly deleteDisabled: boolean;
}

export function privacyControlsView(input: PrivacyControlsViewInput): PrivacyControlsView {
  const busy = input.phase === "requesting_challenge" || input.phase === "deleting";
  const confirmDeletionVisible =
    input.phase === "confirm" ||
    input.phase === "deleting" ||
    (input.phase === "error" && input.hasChallenge === true);
  return {
    exportDisabled: busy || input.phase === "deleted",
    requestDeletionDisabled:
      busy || input.phase === "confirm" || input.phase === "deleted" || confirmDeletionVisible,
    confirmDeletionVisible,
    deleteDisabled:
      !confirmDeletionVisible ||
      input.phase === "deleting" ||
      input.typedConfirmation !== PRIVACY_DELETION_CONFIRMATION
  };
}
