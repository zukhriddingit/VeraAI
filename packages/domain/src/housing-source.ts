import { z } from "zod";

import { EntityIdSchema } from "./primitives.ts";
import { SourceDomainSchema } from "./source-policy.ts";
import { SafeBrowserUrlSchema } from "./source-orchestration.ts";

export const HousingSourceAdapterKindSchema = z.enum([
  "offcampus_partners",
  "generic",
  "craigslist"
]);

export const HousingSourceLoginRequirementSchema = z.enum(["yes", "no", "unknown"]);

export const HousingSourceConfigurationSchema = z
  .object({
    sourceId: EntityIdSchema,
    displayName: z.string().trim().min(1).max(160),
    adapterKind: HousingSourceAdapterKindSchema,
    startingUrl: SafeBrowserUrlSchema,
    allowedDomain: SourceDomainSchema,
    loginRequired: HousingSourceLoginRequirementSchema,
    defaultInclude: z.boolean()
  })
  .strict()
  .superRefine((configuration, context) => {
    const match = configuration.startingUrl.match(/^https:\/\/([^/?#]+)([^#]*)$/u);
    const hostname = match?.[1] ?? "";
    const path = (match?.[2] ?? "").split("?", 1)[0] ?? "";
    if (hostname !== configuration.allowedDomain) {
      context.addIssue({
        code: "custom",
        path: ["startingUrl"],
        message: "Housing-source start URLs must use HTTPS on the exact allowed domain."
      });
    }
    if (configuration.adapterKind === "craigslist") {
      if (!configuration.allowedDomain.endsWith(".craigslist.org")) {
        context.addIssue({
          code: "custom",
          path: ["allowedDomain"],
          message: "Craigslist configurations must use one exact regional craigslist.org domain."
        });
      }
      if (!/^\/search\/(?:apa|roo|sub)(?:\/|$)/u.test(path)) {
        context.addIssue({
          code: "custom",
          path: ["startingUrl"],
          message: "Craigslist configurations must begin on a housing search surface."
        });
      }
    }
  });

export const SelectedHousingSourceConfigurationSchema = HousingSourceConfigurationSchema.extend({
  source: z.enum(["bu_off_campus", "custom_website", "craigslist"]),
  captureCurrentPage: z.boolean().default(false)
})
  .strict()
  .superRefine((configuration, context) => {
    const expectedKind =
      configuration.source === "bu_off_campus"
        ? "offcampus_partners"
        : configuration.source === "craigslist"
          ? "craigslist"
          : "generic";
    if (configuration.adapterKind !== expectedKind) {
      context.addIssue({
        code: "custom",
        path: ["adapterKind"],
        message: "Housing-source selections must match their reviewed adapter family."
      });
    }
    if (configuration.source === "bu_off_campus") {
      if (
        configuration.sourceId !== "bu_off_campus" ||
        configuration.allowedDomain !== "offcampus.bu.edu" ||
        configuration.startingUrl !== "https://offcampus.bu.edu/housing"
      ) {
        context.addIssue({
          code: "custom",
          message: "The built-in BU Off-Campus source cannot be widened or replaced."
        });
      }
    }
  });

export const BU_OFF_CAMPUS_CONFIGURATION = HousingSourceConfigurationSchema.parse({
  sourceId: "bu_off_campus",
  displayName: "BU Off-Campus Housing",
  adapterKind: "offcampus_partners",
  startingUrl: "https://offcampus.bu.edu/housing",
  allowedDomain: "offcampus.bu.edu",
  loginRequired: "unknown",
  defaultInclude: false
});

export const BOSTON_CRAIGSLIST_CONFIGURATION = HousingSourceConfigurationSchema.parse({
  sourceId: "craigslist",
  displayName: "Craigslist",
  adapterKind: "craigslist",
  startingUrl: "https://boston.craigslist.org/search/apa",
  allowedDomain: "boston.craigslist.org",
  loginRequired: "no",
  defaultInclude: false
});

export type HousingSourceAdapterKind = z.infer<typeof HousingSourceAdapterKindSchema>;
export type HousingSourceLoginRequirement = z.infer<typeof HousingSourceLoginRequirementSchema>;
export type HousingSourceConfiguration = z.infer<typeof HousingSourceConfigurationSchema>;
export type SelectedHousingSourceConfiguration = z.infer<
  typeof SelectedHousingSourceConfigurationSchema
>;
