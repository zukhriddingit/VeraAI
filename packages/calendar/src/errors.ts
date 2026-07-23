import { z } from "zod";

export const CalendarProviderErrorCodeSchema = z.enum([
  "calendar_scope_not_granted",
  "calendar_disconnected",
  "calendar_auth_revoked",
  "calendar_permission_denied",
  "calendar_transient_failure",
  "calendar_timeout",
  "calendar_rate_limited",
  "calendar_validation_failed",
  "calendar_conflict_detected",
  "calendar_unknown_insert_outcome"
]);

export type CalendarProviderErrorCode = z.infer<typeof CalendarProviderErrorCodeSchema>;

export const CalendarProviderHttpStatusSchema = z.number().int().min(400).max(599);

export class CalendarProviderError extends Error {
  readonly code: CalendarProviderErrorCode;
  readonly retryable: boolean;
  readonly httpStatus: number;

  constructor(code: CalendarProviderErrorCode, retryable: boolean, httpStatus: number) {
    const validatedCode = CalendarProviderErrorCodeSchema.parse(code);
    const validatedRetryable = z.boolean().parse(retryable);
    const validatedHttpStatus = CalendarProviderHttpStatusSchema.parse(httpStatus);
    super(`Calendar provider operation failed: ${validatedCode}.`);
    this.code = validatedCode;
    this.retryable = validatedRetryable;
    this.httpStatus = validatedHttpStatus;
    this.name = "CalendarProviderError";
  }
}
