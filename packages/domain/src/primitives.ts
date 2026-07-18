import { z } from "zod";

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u);

export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const MoneyCentsSchema = z.number().int().nonnegative();
export const ConfidenceBasisPointsSchema = z.number().int().min(0).max(10_000);
export const PercentageBasisPointsSchema = z.number().int().min(0).max(10_000);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const JsonValueSchema = z.json();
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const ListingSourceLabelSchema = z.enum([
  "zillow",
  "facebook_marketplace",
  "craigslist",
  "apartments_com",
  "other"
]);

export const ListingCaptureMethodSchema = z.enum([
  "fixture",
  "manual_text",
  "manual_structured",
  "official_api",
  "email_alert",
  "local_browser"
]);

export const ListingCaptureAcquisitionMode = {
  fixture: "fixture",
  manual_text: "user_capture",
  manual_structured: "user_capture",
  official_api: "official_api",
  email_alert: "email_alert",
  local_browser: "local_browser"
} as const satisfies Record<z.infer<typeof ListingCaptureMethodSchema>, string>;

export function acquisitionModeForListingCaptureMethod(
  captureMethod: z.infer<typeof ListingCaptureMethodSchema>
) {
  return ListingCaptureAcquisitionMode[captureMethod];
}

export type EntityId = z.infer<typeof EntityIdSchema>;
export type JsonValue = z.infer<typeof JsonValueSchema>;
export type JsonObject = z.infer<typeof JsonObjectSchema>;
export type ListingSourceLabel = z.infer<typeof ListingSourceLabelSchema>;
export type ListingCaptureMethod = z.infer<typeof ListingCaptureMethodSchema>;
