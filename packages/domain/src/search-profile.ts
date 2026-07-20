import { z } from "zod";

import {
  EntityIdSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MoneyCentsSchema,
  PercentageBasisPointsSchema
} from "./primitives.ts";

export const PetRequirementSchema = z
  .object({
    animal: z.enum(["cat", "dog", "other"]),
    required: z.boolean(),
    notes: z.string().trim().min(1).max(500).nullable()
  })
  .strict();

export const CommuteAnchorSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    locationText: z.string().trim().min(1).max(300),
    maximumMinutes: z.number().int().positive().max(240),
    mode: z.enum(["walking", "cycling", "transit", "driving"])
  })
  .strict();

export const SearchConstraintSchema = z
  .object({
    field: z.string().trim().min(1).max(100),
    operator: z.enum(["equals", "at_least", "at_most", "contains"]),
    value: z.union([z.string(), z.number(), z.boolean()]),
    unknownPolicy: z.enum(["allow", "reject"])
  })
  .strict();

export const WeightedPreferenceSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    weightBasisPoints: PercentageBasisPointsSchema,
    unknownBehavior: z.enum(["neutral", "penalize"]).default("neutral"),
    description: z.string().trim().min(1).max(500)
  })
  .strict();

export const NotificationRulesSchema = z
  .object({
    enabled: z.boolean(),
    minimumScoreBasisPoints: PercentageBasisPointsSchema.nullable()
  })
  .strict();

export const SearchProfileSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
    locationText: z.string().trim().min(1).max(300),
    centerLatitude: z.number().min(-90).max(90).nullable(),
    centerLongitude: z.number().min(-180).max(180).nullable(),
    radiusKilometers: z.number().positive().max(500).nullable(),
    minimumBedrooms: z.number().nonnegative().max(20).multipleOf(0.5).nullable(),
    minimumBathrooms: z.number().nonnegative().max(20).multipleOf(0.5).nullable(),
    targetMonthlyTotalCents: MoneyCentsSchema.nullable(),
    absoluteMonthlyMaximumCents: MoneyCentsSchema.nullable(),
    moveInEarliest: IsoDateSchema.nullable(),
    moveInLatest: IsoDateSchema.nullable(),
    petRequirements: z.array(PetRequirementSchema),
    commuteAnchors: z.array(CommuteAnchorSchema),
    hardConstraints: z.array(SearchConstraintSchema),
    weightedPreferences: z.array(WeightedPreferenceSchema),
    notificationRules: NotificationRulesSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  })
  .strict()
  .superRefine((profile, context) => {
    const preferenceCodes = profile.weightedPreferences.map((preference) => preference.code);
    if (new Set(preferenceCodes).size !== preferenceCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["weightedPreferences"],
        message: "Weighted preference codes must be unique."
      });
    }

    if (
      profile.targetMonthlyTotalCents !== null &&
      profile.absoluteMonthlyMaximumCents !== null &&
      profile.targetMonthlyTotalCents > profile.absoluteMonthlyMaximumCents
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetMonthlyTotalCents"],
        message: "Target monthly total cannot exceed the absolute maximum."
      });
    }

    if (
      profile.moveInEarliest !== null &&
      profile.moveInLatest !== null &&
      profile.moveInEarliest > profile.moveInLatest
    ) {
      context.addIssue({
        code: "custom",
        path: ["moveInEarliest"],
        message: "The earliest move-in date cannot follow the latest date."
      });
    }
  });

export type SearchProfile = z.infer<typeof SearchProfileSchema>;
export type UnknownPreferenceBehavior = z.infer<
  typeof WeightedPreferenceSchema.shape.unknownBehavior
>;
