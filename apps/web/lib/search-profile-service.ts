import { randomUUID } from "node:crypto";

import {
  createSearchIntentProvider,
  isLLMError,
  LLMInvalidOutputError,
  type SearchIntentProvider
} from "@vera/ai";
import {
  ActivityEventSchema,
  CreateSearchProfileRequestSchema,
  SearchIntentDraftSchema,
  SearchIntentInterpretRequestSchema,
  SearchProfileSchema,
  type CreateSearchProfileRequest,
  type SearchAmenityCode,
  type SearchIntentDraft,
  type SearchIntentInterpretRequest,
  type SearchProfile,
  type VeraUserId
} from "@vera/domain";
import {
  canonicalJson,
  PostgresRepositoryError,
  sha256Text,
  type UserRepositoryProvider
} from "@vera/db";

const AMENITY_LABELS: Readonly<Record<SearchAmenityCode, string>> = {
  laundry_in_unit: "Laundry in unit",
  laundry_in_building: "Laundry in building",
  parking: "Parking",
  dishwasher: "Dishwasher",
  air_conditioning: "Air conditioning",
  elevator: "Elevator",
  outdoor_space: "Outdoor space"
};

export class SearchProfileServiceError extends Error {
  readonly code:
    | "interpretation_unavailable"
    | "interpretation_invalid"
    | "profile_conflict"
    | "profile_unavailable";
  readonly status: 409 | 422 | 503;

  constructor(
    code: SearchProfileServiceError["code"],
    status: SearchProfileServiceError["status"]
  ) {
    super(
      code === "interpretation_unavailable"
        ? "Search interpretation is unavailable. Enter the filters manually."
        : code === "interpretation_invalid"
          ? "Vera could not safely interpret that description. Review the filters manually."
          : code === "profile_conflict"
            ? "That profile changed before it could be saved. Review and save it again."
            : "Search profiles are temporarily unavailable."
    );
    this.name = "SearchProfileServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface InterpretSearchIntentDependencies {
  readonly provider: SearchIntentProvider | null;
  readonly signal: AbortSignal;
  readonly timeoutMilliseconds: number;
}

export async function interpretSearchIntent(
  input: SearchIntentInterpretRequest,
  dependencies: InterpretSearchIntentDependencies
): Promise<SearchIntentDraft> {
  const request = SearchIntentInterpretRequestSchema.parse(input);
  if (dependencies.provider === null) {
    throw new SearchProfileServiceError("interpretation_unavailable", 503);
  }

  try {
    return SearchIntentDraftSchema.parse(
      await dependencies.provider.interpret(request, {
        signal: dependencies.signal,
        timeoutMilliseconds: dependencies.timeoutMilliseconds
      })
    );
  } catch (error: unknown) {
    if (error instanceof LLMInvalidOutputError) {
      throw new SearchProfileServiceError("interpretation_invalid", 422);
    }
    if (isLLMError(error)) {
      throw new SearchProfileServiceError("interpretation_unavailable", 503);
    }
    throw error;
  }
}

export function createEnvironmentSearchIntentProvider(
  environment: Readonly<Record<string, string | undefined>>
): SearchIntentProvider | null {
  return createSearchIntentProvider(environment);
}

export interface CreateSearchProfileDependencies {
  readonly userId: VeraUserId;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

function preferredAmenities(draft: SearchIntentDraft): SearchProfile["weightedPreferences"] {
  const preferred = draft.amenities.filter(({ priority }) => priority === "preferred");
  if (preferred.length === 0) return [];
  const weight = Math.floor(10_000 / preferred.length);
  return preferred.map(({ code }, index) => ({
    code,
    weightBasisPoints:
      index === preferred.length - 1 ? 10_000 - weight * (preferred.length - 1) : weight,
    unknownBehavior: "neutral",
    description: AMENITY_LABELS[code]
  }));
}

function requiredAmenities(draft: SearchIntentDraft): SearchProfile["hardConstraints"] {
  return draft.amenities
    .filter(({ priority }) => priority === "required")
    .map(({ code }) => ({
      field: "amenities",
      operator: "contains" as const,
      value: code,
      unknownPolicy: "reject" as const
    }));
}

function asCents(dollars: number | null): number | null {
  return dollars === null ? null : dollars * 100;
}

export async function createSearchProfile(
  input: CreateSearchProfileRequest,
  dependencies: CreateSearchProfileDependencies
): Promise<SearchProfile> {
  const request = CreateSearchProfileRequestSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? randomUUID;

  try {
    return await dependencies.repositoryProvider.transaction(
      dependencies.userId,
      async (repositories) => {
        const profiles = await repositories.searchProfiles.list();
        const base =
          request.basedOnProfileId === null
            ? null
            : await repositories.searchProfiles.getById(request.basedOnProfileId);
        if (request.basedOnProfileId !== null && base === null) {
          throw new SearchProfileServiceError("profile_conflict", 409);
        }

        const name = base?.name ?? request.draft.profileName;
        const locationText = request.draft.locationText;
        if (name === null || locationText === null) {
          throw new SearchProfileServiceError("profile_conflict", 409);
        }

        const version =
          profiles
            .filter((profile) => profile.name === name)
            .reduce((maximum, profile) => Math.max(maximum, profile.version), 0) + 1;
        const occurredAt = now().toISOString();
        const profile = SearchProfileSchema.parse({
          id: createId(),
          name,
          version,
          locationText,
          centerLatitude: null,
          centerLongitude: null,
          radiusKilometers: null,
          minimumBedrooms: request.draft.minimumBedrooms,
          minimumBathrooms: request.draft.minimumBathrooms,
          targetMonthlyTotalCents: asCents(request.draft.targetMonthlyBudgetDollars),
          absoluteMonthlyMaximumCents: asCents(request.draft.maximumMonthlyBudgetDollars),
          moveInEarliest: request.draft.moveInEarliest,
          moveInLatest: request.draft.moveInLatest,
          petRequirements: request.draft.pets.map((animal) => ({
            animal,
            required: true,
            notes: null
          })),
          commuteAnchors: request.draft.commuteAnchors,
          hardConstraints: requiredAmenities(request.draft),
          weightedPreferences: preferredAmenities(request.draft),
          notificationRules: { enabled: false, minimumScoreBasisPoints: null },
          createdAt: occurredAt,
          updatedAt: occurredAt
        });
        const persisted = await repositories.searchProfiles.insert(profile);
        const eventId = createId();
        await repositories.activityEvents.append(
          ActivityEventSchema.parse({
            id: eventId,
            correlationId: eventId,
            causationId: request.basedOnProfileId,
            actor: "user",
            action: "search_profile.created",
            targetType: "search_profile",
            targetId: persisted.id,
            policyDecision: "not_applicable",
            approvalId: null,
            payloadHash: sha256Text(
              `search-profile:v1:${canonicalJson({
                id: persisted.id,
                name: persisted.name,
                version: persisted.version,
                locationText: persisted.locationText,
                minimumBedrooms: persisted.minimumBedrooms,
                minimumBathrooms: persisted.minimumBathrooms,
                targetMonthlyTotalCents: persisted.targetMonthlyTotalCents,
                absoluteMonthlyMaximumCents: persisted.absoluteMonthlyMaximumCents,
                moveInEarliest: persisted.moveInEarliest,
                moveInLatest: persisted.moveInLatest,
                petRequirements: persisted.petRequirements,
                commuteAnchors: persisted.commuteAnchors,
                hardConstraints: persisted.hardConstraints,
                weightedPreferences: persisted.weightedPreferences
              })}`
            ),
            outcome: "succeeded",
            errorCategory: null,
            metadata: {
              version: persisted.version,
              basedOnProfileId: request.basedOnProfileId
            },
            occurredAt
          })
        );
        return persisted;
      }
    );
  } catch (error: unknown) {
    if (error instanceof SearchProfileServiceError) throw error;
    if (error instanceof PostgresRepositoryError && error.category === "conflict") {
      throw new SearchProfileServiceError("profile_conflict", 409);
    }
    throw new SearchProfileServiceError("profile_unavailable", 503);
  }
}
