import { describe, expect, it } from "vitest";

import {
  CalendarProviderError,
  CalendarProviderErrorCodeSchema,
  CalendarProviderHttpStatusSchema,
  type CalendarProviderErrorCode
} from "./errors.ts";

describe("CalendarProviderError", () => {
  it("uses the closed error code set", () => {
    expect(CalendarProviderErrorCodeSchema.options).toEqual([
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
  });

  it("retains only safe categorical metadata", () => {
    const error = new CalendarProviderError("calendar_timeout", true, 504);

    expect(error).toMatchObject({
      name: "CalendarProviderError",
      message: "Calendar provider operation failed: calendar_timeout.",
      code: "calendar_timeout",
      retryable: true,
      httpStatus: 504
    });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("body");
    expect(error).not.toHaveProperty("token");
    expect(error).not.toHaveProperty("url");
    expect(error).not.toHaveProperty("description");
    expect(JSON.stringify(error)).toBe(
      '{"code":"calendar_timeout","retryable":true,"httpStatus":504,"name":"CalendarProviderError"}'
    );
  });

  it("validates the provider code at runtime", () => {
    expect(
      () =>
        new CalendarProviderError("provider leaked message" as CalendarProviderErrorCode, true, 500)
    ).toThrow();
  });

  it("accepts only HTTP error status boundaries", () => {
    expect(CalendarProviderHttpStatusSchema.parse(400)).toBe(400);
    expect(CalendarProviderHttpStatusSchema.parse(599)).toBe(599);
    expect(() => new CalendarProviderError("calendar_timeout", true, 399)).toThrow();
    expect(() => new CalendarProviderError("calendar_timeout", true, 600)).toThrow();
    expect(() => new CalendarProviderError("calendar_timeout", true, 500.5)).toThrow();
    expect(() => new CalendarProviderError("calendar_timeout", true, Number.NaN)).toThrow();
  });

  it("validates retryability rather than trusting an erased TypeScript type", () => {
    expect(
      () => new CalendarProviderError("calendar_timeout", "yes" as unknown as boolean, 504)
    ).toThrow();
  });
});
