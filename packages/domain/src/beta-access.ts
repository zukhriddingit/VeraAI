import { z } from "zod";

import type { VeraUserId } from "./identity.ts";

export const BETA_CONSENT_VERSION = "vera-private-beta-contact.v1" as const;

export const BetaAccessRequestStatusSchema = z.enum([
  "requested",
  "invited",
  "declined",
  "withdrawn"
]);

export const BetaMembershipStatusSchema = z.enum(["invited", "active", "revoked"]);

export function normalizeBetaEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

export const BetaEmailSchema = z
  .string()
  .max(320)
  .transform(normalizeBetaEmail)
  .pipe(z.email().max(320));

export const BetaAccessSubmissionSchema = z
  .object({
    email: BetaEmailSchema,
    consent: z.literal(true),
    consentVersion: z.literal(BETA_CONSENT_VERSION),
    website: z.literal("")
  })
  .strict();

export const BetaAccessAcceptedResponseSchema = z
  .object({
    accepted: z.literal(true),
    code: z.literal("request_received")
  })
  .strict();

export const BetaAccessReviewSchema = z
  .object({
    action: z.enum(["invite", "decline", "withdraw"])
  })
  .strict();

export interface BetaAccessRequest {
  readonly id: string;
  readonly normalizedEmail: string;
  readonly status: z.infer<typeof BetaAccessRequestStatusSchema>;
  readonly consentVersion: typeof BETA_CONSENT_VERSION;
  readonly consentedAt: Date;
  readonly requestedAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewedByUserId: VeraUserId | null;
}

export interface BetaMembership {
  readonly id: string;
  readonly normalizedEmail: string;
  readonly userId: VeraUserId | null;
  readonly status: z.infer<typeof BetaMembershipStatusSchema>;
  readonly invitedAt: Date;
  readonly activatedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly approvedByUserId: VeraUserId | null;
}

export type BetaAccessReviewAction = z.infer<typeof BetaAccessReviewSchema>["action"];
export type BetaAccessRequestStatus = z.infer<typeof BetaAccessRequestStatusSchema>;
