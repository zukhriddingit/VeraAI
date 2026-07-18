import { describe, expect, it } from "vitest";

import {
  ALLOWED_LISTING_TRANSITIONS,
  InvalidListingTransitionError,
  ListingLifecycleStateSchema,
  TERMINAL_LISTING_STATES,
  transitionListingLifecycle,
  type ListingLifecycleState
} from "./index.ts";

describe("listing lifecycle", () => {
  it("allows every declared transition", () => {
    for (const current of ListingLifecycleStateSchema.options) {
      const nextStates: readonly ListingLifecycleState[] = ALLOWED_LISTING_TRANSITIONS[current];

      for (const next of nextStates) {
        expect(transitionListingLifecycle(current, next)).toBe(next);
      }
    }
  });

  it("allows a user to remove a shortlisted listing", () => {
    expect(transitionListingLifecycle("new", "shortlisted")).toBe("shortlisted");
    expect(transitionListingLifecycle("shortlisted", "new")).toBe("new");
  });

  it("rejects skipped and reversed transitions", () => {
    expect(() => transitionListingLifecycle("new", "tour_scheduled")).toThrow(
      InvalidListingTransitionError
    );
    expect(() => transitionListingLifecycle("draft_ready", "shortlisted")).toThrow(
      InvalidListingTransitionError
    );
  });

  it("keeps terminal states terminal", () => {
    for (const terminal of TERMINAL_LISTING_STATES) {
      expect(ALLOWED_LISTING_TRANSITIONS[terminal]).toHaveLength(0);
      expect(() => transitionListingLifecycle(terminal, "shortlisted")).toThrow(
        InvalidListingTransitionError
      );
    }
  });

  it("reports both states in a typed transition error", () => {
    try {
      transitionListingLifecycle("new", "toured");
      throw new Error("Expected the transition to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(InvalidListingTransitionError);

      if (!(error instanceof InvalidListingTransitionError)) {
        throw error;
      }

      expect(error.current).toBe("new");
      expect(error.requested).toBe("toured");
    }
  });
});
