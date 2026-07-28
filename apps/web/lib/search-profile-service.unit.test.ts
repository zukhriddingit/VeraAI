import type {
  ActivityEvent,
  CreateSearchProfileRequest,
  SearchProfile,
  VeraUserId
} from "@vera/domain";
import type { UserRepositories, UserRepositoryProvider } from "@vera/db";
import { describe, expect, it } from "vitest";

import {
  createSearchProfile,
  SearchProfileServiceError,
  type CreateSearchProfileDependencies
} from "./search-profile-service.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-000000000001" as VeraUserId;
const PRIVATE_DESCRIPTION =
  "Private description that must never enter profile or audit persistence.";

const request = (overrides: Partial<CreateSearchProfileRequest> = {}) =>
  ({
    draft: {
      schemaVersion: "1",
      profileName: "Boston September search",
      locationText: "Boston, MA",
      targetMonthlyBudgetDollars: 2_700,
      maximumMonthlyBudgetDollars: 2_900,
      minimumBedrooms: 1,
      minimumBathrooms: 1,
      moveInEarliest: "2026-09-01",
      moveInLatest: "2026-09-15",
      pets: ["cat"],
      commuteAnchors: [
        {
          label: "BU",
          locationText: "Boston University",
          maximumMinutes: 35,
          mode: "transit"
        }
      ],
      amenities: [
        { code: "laundry_in_building", priority: "required" },
        { code: "dishwasher", priority: "preferred" }
      ],
      ambiguities: []
    },
    basedOnProfileId: null,
    ...overrides
  }) satisfies CreateSearchProfileRequest;

function fixture(existing: readonly SearchProfile[] = []) {
  const profiles = [...existing];
  const events: ActivityEvent[] = [];
  let transactionCount = 0;
  let nextId = 0;

  const repositories = {
    searchProfiles: {
      async insert(profile: SearchProfile) {
        profiles.push(structuredClone(profile));
        return structuredClone(profile);
      },
      async getById(id: string) {
        return structuredClone(profiles.find((profile) => profile.id === id) ?? null);
      },
      async list() {
        return structuredClone(profiles);
      },
      async count() {
        return profiles.length;
      }
    },
    activityEvents: {
      async append(event: ActivityEvent) {
        events.push(structuredClone(event));
        return structuredClone(event);
      }
    }
  } as unknown as UserRepositories;

  const repositoryProvider = {
    forUser() {
      return repositories;
    },
    async transaction(_userId, operation) {
      transactionCount += 1;
      return operation(repositories);
    }
  } satisfies UserRepositoryProvider;

  const dependencies: CreateSearchProfileDependencies = {
    userId: USER_ID,
    repositoryProvider,
    now: () => new Date("2026-07-28T18:00:00.000Z"),
    createId: () => `search-profile-test-${String(++nextId)}`
  };

  return {
    dependencies,
    profiles,
    events,
    transactionCount: () => transactionCount
  };
}

describe("createSearchProfile", () => {
  it("persists a strict version 1 profile and its audit in one transaction", async () => {
    const state = fixture();

    const profile = await createSearchProfile(request(), state.dependencies);

    expect(profile).toMatchObject({
      name: "Boston September search",
      version: 1,
      locationText: "Boston, MA",
      targetMonthlyTotalCents: 270_000,
      absoluteMonthlyMaximumCents: 290_000,
      minimumBedrooms: 1,
      minimumBathrooms: 1,
      petRequirements: [{ animal: "cat", required: true, notes: null }],
      commuteAnchors: [
        {
          label: "BU",
          locationText: "Boston University",
          maximumMinutes: 35,
          mode: "transit"
        }
      ],
      hardConstraints: [
        {
          field: "amenities",
          operator: "contains",
          value: "laundry_in_building",
          unknownPolicy: "reject"
        }
      ],
      weightedPreferences: [
        {
          code: "dishwasher",
          weightBasisPoints: 10_000,
          unknownBehavior: "neutral",
          description: "Dishwasher"
        }
      ]
    });
    expect(state.profiles).toHaveLength(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      action: "search_profile.created",
      targetType: "search_profile",
      targetId: profile.id,
      actor: "user",
      outcome: "succeeded",
      metadata: { version: 1, basedOnProfileId: null }
    });
    expect(state.transactionCount()).toBe(1);
  });

  it("creates a new immutable version using the base profile's logical name", async () => {
    const firstState = fixture();
    const first = await createSearchProfile(request(), firstState.dependencies);
    const state = fixture([first]);
    const changed = request({
      basedOnProfileId: first.id,
      draft: {
        ...request().draft,
        profileName: "Attempted rename",
        maximumMonthlyBudgetDollars: 3_000
      }
    });

    const second = await createSearchProfile(changed, state.dependencies);

    expect(second).toMatchObject({
      name: first.name,
      version: 2,
      absoluteMonthlyMaximumCents: 300_000
    });
    expect(state.profiles[0]).toEqual(first);
    expect(state.profiles).toHaveLength(2);
    expect(state.events[0]?.metadata).toEqual({
      version: 2,
      basedOnProfileId: first.id
    });
  });

  it("keeps free-form interpretation and private commute text out of audit metadata", async () => {
    const state = fixture();
    const input = request();
    await createSearchProfile(input, state.dependencies);

    const audit = JSON.stringify(state.events);
    expect(audit).not.toContain(PRIVATE_DESCRIPTION);
    expect(audit).not.toContain(input.draft.commuteAnchors[0]?.locationText);
    expect(audit).not.toContain(input.draft.profileName);
  });

  it("rejects an unknown base profile without inserting a replacement", async () => {
    const state = fixture();

    await expect(
      createSearchProfile(
        request({ basedOnProfileId: "profile-that-does-not-exist" }),
        state.dependencies
      )
    ).rejects.toBeInstanceOf(SearchProfileServiceError);
    expect(state.profiles).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});
