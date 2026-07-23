import { ListingLifecycleStateSchema, type ListingLifecycleState } from "./listing.ts";

export const TERMINAL_LISTING_STATES = [
  "passed",
  "dismissed",
  "stale",
  "unavailable"
] as const satisfies readonly ListingLifecycleState[];

export const ALLOWED_LISTING_TRANSITIONS = {
  new: ["shortlisted", "dismissed", "stale", "unavailable"],
  shortlisted: ["new", "draft_ready", "dismissed", "stale", "unavailable"],
  draft_ready: ["draft_created", "draft_rejected", "dismissed", "stale", "unavailable"],
  draft_created: ["replied", "follow_up_due", "dismissed", "stale", "unavailable"],
  draft_rejected: ["draft_ready", "dismissed", "stale", "unavailable"],
  replied: ["tour_proposed", "dismissed", "stale", "unavailable"],
  follow_up_due: ["replied", "dismissed", "stale", "unavailable"],
  tour_proposed: ["tour_scheduled", "replied", "dismissed", "stale", "unavailable"],
  tour_scheduled: ["tour_proposed", "replied", "toured", "dismissed", "unavailable"],
  toured: ["applying", "passed"],
  applying: ["passed"],
  passed: [],
  dismissed: [],
  stale: [],
  unavailable: []
} as const satisfies Record<ListingLifecycleState, readonly ListingLifecycleState[]>;

export class InvalidListingTransitionError extends Error {
  readonly current: ListingLifecycleState;
  readonly requested: ListingLifecycleState;

  constructor(current: ListingLifecycleState, requested: ListingLifecycleState) {
    super(`Listing lifecycle cannot transition from ${current} to ${requested}.`);
    this.name = "InvalidListingTransitionError";
    this.current = current;
    this.requested = requested;
  }
}

export function transitionListingLifecycle(
  currentInput: ListingLifecycleState,
  requestedInput: ListingLifecycleState
): ListingLifecycleState {
  const current = ListingLifecycleStateSchema.parse(currentInput);
  const requested = ListingLifecycleStateSchema.parse(requestedInput);
  const allowed: readonly ListingLifecycleState[] = ALLOWED_LISTING_TRANSITIONS[current];

  if (!allowed.includes(requested)) {
    throw new InvalidListingTransitionError(current, requested);
  }

  return requested;
}
