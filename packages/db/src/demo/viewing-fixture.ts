import { ActivityEventSchema, type ListingLifecycleState } from "@vera/domain";

import { canonicalJson, sha256Text } from "../hashing.ts";
import type { UserRepositoryProvider } from "../repositories.ts";
import { DEMO_USER_ID } from "./constants.ts";

export const DEMO_VIEWING_ADDRESS_LINE_1 = "44 Maple Crescent";
export const DEMO_VIEWING_ADDRESS_UNIT = "2B";
export const DEMO_VIEWING_LISTING_TITLE = "Maple Crescent 2B";

const DEMO_VIEWING_FIXTURE_CORRELATION_ID = "correlation-demo-viewing-ready";
const DEMO_VIEWING_FIXTURE_PREPARED_AT = "2026-07-20T18:10:00.000Z";

const lifecyclePath = [
  "new",
  "shortlisted",
  "draft_ready",
  "draft_created",
  "replied"
] as const satisfies readonly ListingLifecycleState[];

/**
 * Makes one sanitized listing eligible for the offline Calendar walkthrough by exercising the
 * same domain lifecycle boundary as normal product behavior. The helper belongs to the isolated
 * demo adapter so hosted startup and production fixtures cannot call it accidentally.
 */
export async function prepareDemoViewingFixture(
  repositoryProvider: UserRepositoryProvider
): Promise<void> {
  await repositoryProvider.transaction(DEMO_USER_ID, async (repositories) => {
    const matches = (await repositories.canonicalListings.list()).filter(
      ({ address }) =>
        address.line1 === DEMO_VIEWING_ADDRESS_LINE_1 && address.unit === DEMO_VIEWING_ADDRESS_UNIT
    );
    if (matches.length !== 1) {
      throw new Error("The sanitized demo viewing listing is unavailable.");
    }
    const listing = matches[0]!;
    const eventId = `event-demo-viewing-ready:${listing.id}`;

    const currentIndex = lifecyclePath.indexOf(
      listing.lifecycleState as (typeof lifecyclePath)[number]
    );
    if (currentIndex < 0) {
      if (["tour_proposed", "tour_scheduled"].includes(listing.lifecycleState)) return;
      throw new Error("The sanitized demo viewing listing is in an unsupported lifecycle state.");
    }

    for (const requested of lifecyclePath.slice(currentIndex + 1)) {
      await repositories.canonicalListings.transitionLifecycle(
        listing.id,
        requested,
        DEMO_VIEWING_FIXTURE_PREPARED_AT
      );
    }

    const existingEvent = await repositories.activityEvents.getById(eventId);
    if (existingEvent !== null) return;

    const payload = {
      fixtureVersion: 1,
      listingId: listing.id,
      lifecycleState: "replied",
      networkAccess: false,
      sanitized: true
    } as const;
    await repositories.activityEvents.append(
      ActivityEventSchema.parse({
        id: eventId,
        correlationId: DEMO_VIEWING_FIXTURE_CORRELATION_ID,
        causationId: null,
        actor: "system",
        action: "demo.viewing_fixture.prepared",
        targetType: "canonical_listing",
        targetId: listing.id,
        policyDecision: "not_applicable",
        approvalId: null,
        payloadHash: sha256Text(`demo-viewing-fixture:v1:${canonicalJson(payload)}`),
        outcome: "succeeded",
        errorCategory: null,
        metadata: payload,
        occurredAt: DEMO_VIEWING_FIXTURE_PREPARED_AT
      })
    );
  });
}
