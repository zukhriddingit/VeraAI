import { z } from "zod";

import { EntityIdSchema, IsoDateSchema } from "./primitives.ts";
import { SearchProfileSchema } from "./search-profile.ts";

const SafeShortTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => !/<\/?[a-z][^>]*>/iu.test(value), "Text cannot contain HTML.")
  .refine((value) => !/\bhttps?:\/\/|\bwww\./iu.test(value), "Text cannot contain URLs.");

export const SearchLocationSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      /^\d{5}$/u.test(value) || /^[A-Za-z][A-Za-z .'-]{0,79}, [A-Z]{2}$/u.test(value),
    "Location must be a five-digit ZIP code or City, ST."
  );

export const SearchAmenityCodeSchema = z.enum([
  "laundry_in_unit",
  "laundry_in_building",
  "parking",
  "dishwasher",
  "air_conditioning",
  "elevator",
  "outdoor_space"
]);

export const SearchIntentAmenitySchema = z
  .object({
    code: SearchAmenityCodeSchema,
    priority: z.enum(["required", "preferred"])
  })
  .strict();

export const SearchIntentCommuteAnchorSchema = z
  .object({
    label: SafeShortTextSchema.max(120),
    locationText: SafeShortTextSchema,
    maximumMinutes: z.number().int().positive().max(240),
    mode: z.enum(["walking", "cycling", "transit", "driving"])
  })
  .strict();

const DollarBudgetSchema = z.number().int().nonnegative().max(1_000_000);

export const SearchIntentDraftSchema = z
  .object({
    schemaVersion: z.literal("1"),
    profileName: SafeShortTextSchema.max(120).nullable(),
    locationText: SearchLocationSchema.nullable(),
    targetMonthlyBudgetDollars: DollarBudgetSchema.nullable(),
    maximumMonthlyBudgetDollars: DollarBudgetSchema.nullable(),
    minimumBedrooms: z.number().nonnegative().max(20).multipleOf(0.5).nullable(),
    minimumBathrooms: z.number().nonnegative().max(20).multipleOf(0.5).nullable(),
    moveInEarliest: IsoDateSchema.nullable(),
    moveInLatest: IsoDateSchema.nullable(),
    pets: z.array(z.enum(["cat", "dog", "other"])).max(3),
    commuteAnchors: z.array(SearchIntentCommuteAnchorSchema).max(5),
    amenities: z.array(SearchIntentAmenitySchema).max(SearchAmenityCodeSchema.options.length),
    ambiguities: z.array(SafeShortTextSchema).max(8)
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      draft.targetMonthlyBudgetDollars !== null &&
      draft.maximumMonthlyBudgetDollars !== null &&
      draft.targetMonthlyBudgetDollars > draft.maximumMonthlyBudgetDollars
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetMonthlyBudgetDollars"],
        message: "Target monthly budget cannot exceed the maximum."
      });
    }

    if (
      draft.moveInEarliest !== null &&
      draft.moveInLatest !== null &&
      draft.moveInEarliest > draft.moveInLatest
    ) {
      context.addIssue({
        code: "custom",
        path: ["moveInEarliest"],
        message: "The earliest move-in date cannot follow the latest date."
      });
    }

    if (new Set(draft.pets).size !== draft.pets.length) {
      context.addIssue({
        code: "custom",
        path: ["pets"],
        message: "Pet requirements must be unique."
      });
    }

    const amenityCodes = draft.amenities.map(({ code }) => code);
    if (new Set(amenityCodes).size !== amenityCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["amenities"],
        message: "Amenity requirements must be unique."
      });
    }
  });

export const SearchIntentInterpretRequestSchema = z
  .object({
    description: z.string().trim().min(3).max(2_000)
  })
  .strict();

export const SearchIntentInterpretResponseSchema = z
  .object({
    draft: SearchIntentDraftSchema
  })
  .strict();

export const CreateSearchProfileRequestSchema = z
  .object({
    draft: SearchIntentDraftSchema,
    basedOnProfileId: EntityIdSchema.nullable().default(null)
  })
  .strict()
  .superRefine((request, context) => {
    if (request.draft.profileName === null) {
      context.addIssue({
        code: "custom",
        path: ["draft", "profileName"],
        message: "A reviewed profile name is required."
      });
    }
    if (request.draft.locationText === null) {
      context.addIssue({
        code: "custom",
        path: ["draft", "locationText"],
        message: "A reviewed location is required."
      });
    }
  });

export const CreateSearchProfileResponseSchema = z
  .object({
    profile: SearchProfileSchema
  })
  .strict();

export const SearchProfileMutationErrorCodeSchema = z.enum([
  "unauthorized",
  "cross_origin_request",
  "malformed_request",
  "interpretation_unavailable",
  "interpretation_invalid",
  "profile_conflict",
  "profile_unavailable"
]);

export const SearchProfileMutationErrorSchema = z
  .object({
    code: SearchProfileMutationErrorCodeSchema,
    message: z.string().trim().min(1).max(300)
  })
  .strict();

export type SearchAmenityCode = z.infer<typeof SearchAmenityCodeSchema>;
export type SearchIntentAmenity = z.infer<typeof SearchIntentAmenitySchema>;
export type SearchIntentCommuteAnchor = z.infer<typeof SearchIntentCommuteAnchorSchema>;
export type SearchIntentDraft = z.infer<typeof SearchIntentDraftSchema>;
export type SearchIntentInterpretRequest = z.infer<typeof SearchIntentInterpretRequestSchema>;
export type CreateSearchProfileRequest = z.infer<typeof CreateSearchProfileRequestSchema>;
export type SearchProfileMutationErrorCode = z.infer<
  typeof SearchProfileMutationErrorCodeSchema
>;
