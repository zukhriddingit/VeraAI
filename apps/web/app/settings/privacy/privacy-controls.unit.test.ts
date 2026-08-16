import { describe, expect, it } from "vitest";

import { privacyControlsView } from "./privacy-controls-view.ts";

describe("privacy controls view", () => {
  it("keeps export and deletion available before a challenge is requested", () => {
    expect(privacyControlsView({ phase: "idle", typedConfirmation: "" })).toMatchObject({
      exportDisabled: false,
      requestDeletionDisabled: false,
      confirmDeletionVisible: false
    });
  });

  it("enables permanent deletion only for the exact confirmation phrase", () => {
    expect(
      privacyControlsView({
        phase: "confirm",
        typedConfirmation: "DELETE MY VERA ACCOUNT",
        hasChallenge: true
      })
    ).toMatchObject({ confirmDeletionVisible: true, deleteDisabled: false });
    expect(
      privacyControlsView({
        phase: "confirm",
        typedConfirmation: "delete my vera account",
        hasChallenge: true
      }).deleteDisabled
    ).toBe(true);
  });

  it("locks every destructive control while deletion is in progress", () => {
    expect(
      privacyControlsView({
        phase: "deleting",
        typedConfirmation: "DELETE MY VERA ACCOUNT",
        hasChallenge: true
      })
    ).toEqual({
      exportDisabled: true,
      requestDeletionDisabled: true,
      confirmDeletionVisible: true,
      deleteDisabled: true
    });
  });
});
