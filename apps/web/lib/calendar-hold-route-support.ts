import { CalendarApiErrorResponseSchema } from "@vera/domain";
import { ZodError } from "zod";

import { CalendarHoldServiceError, createCalendarHoldService } from "./calendar-hold-service.ts";
import { getHostedApplication } from "./server/application.ts";
import {
  CrossOriginMutationError,
  MutationRequestError,
  readBoundedJson
} from "./server/request-security.ts";
import { AuthenticationRequiredError, requireVeraSession } from "./server/session.ts";

export const calendarRouteHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json"
} as const;

export const MAX_CALENDAR_MUTATION_BODY_BYTES = 16_384;

/**
 * Calendar mutations carry only identifiers and short user-authored notes. Reading the
 * stream incrementally prevents an authenticated request from buffering an unbounded body.
 */
export async function readCalendarMutationJson(request: Request): Promise<unknown> {
  return readBoundedJson(request, { maxBytes: MAX_CALENDAR_MUTATION_BODY_BYTES });
}

export async function calendarRouteService(request: Request) {
  const application = getHostedApplication();
  const session = await requireVeraSession(request.headers, application);
  return createCalendarHoldService({
    userId: session.userId,
    repositories: session.repositories,
    repositoryProvider: session.repositoryProvider,
    calendar: application.calendar
  });
}

function recovery(code: string) {
  switch (code) {
    case "calendar_scope_not_granted":
      return {
        action: "connect" as const,
        message: "Enable the required Google Calendar capability and try again.",
        authorizationCapability: "calendar_hold_creation" as const
      };
    case "calendar_disconnected":
      return {
        action: "reconnect" as const,
        message: "Reconnect Google Calendar and try again.",
        authorizationCapability: "calendar_hold_creation" as const
      };
    case "calendar_temporarily_unavailable":
    case "calendar_creation_failed":
      return {
        action: "retry" as const,
        message: "Retry after reviewing the visible Calendar status.",
        authorizationCapability: null
      };
    case "viewing_conflict_detected":
      return {
        action: "choose_replacement" as const,
        message: "Choose a checked replacement window.",
        authorizationCapability: null
      };
    default:
      return {
        action: "none" as const,
        message: "Review the request and try again.",
        authorizationCapability: null
      };
  }
}

export function calendarRouteError(error: unknown): Response {
  const generatedAt = new Date().toISOString();
  if (error instanceof AuthenticationRequiredError) {
    return Response.json(
      CalendarApiErrorResponseSchema.parse({
        code: "unauthorized",
        message: "Authentication required.",
        recovery: recovery("unauthorized"),
        generatedAt
      }),
      { status: 401, headers: calendarRouteHeaders }
    );
  }
  if (error instanceof CrossOriginMutationError) {
    return Response.json(
      CalendarApiErrorResponseSchema.parse({
        code: "cross_origin_request",
        message: "Request origin is not allowed.",
        recovery: recovery("cross_origin_request"),
        generatedAt
      }),
      { status: 403, headers: calendarRouteHeaders }
    );
  }
  if (error instanceof MutationRequestError) {
    return Response.json(
      CalendarApiErrorResponseSchema.parse({
        code: "invalid_request",
        message: "The Calendar request is invalid.",
        recovery: recovery("invalid_request"),
        generatedAt
      }),
      { status: error.status, headers: calendarRouteHeaders }
    );
  }
  if (error instanceof CalendarHoldServiceError) {
    return Response.json(
      CalendarApiErrorResponseSchema.parse({
        code: error.code,
        message: error.message,
        recovery: recovery(error.code),
        generatedAt
      }),
      { status: error.httpStatus, headers: calendarRouteHeaders }
    );
  }
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return Response.json(
      CalendarApiErrorResponseSchema.parse({
        code: "invalid_request",
        message: "The Calendar request is invalid.",
        recovery: recovery("invalid_request"),
        generatedAt
      }),
      { status: 400, headers: calendarRouteHeaders }
    );
  }
  return Response.json(
    CalendarApiErrorResponseSchema.parse({
      code: "calendar_creation_failed",
      message: "The Calendar operation is temporarily unavailable.",
      recovery: recovery("calendar_creation_failed"),
      generatedAt
    }),
    { status: 503, headers: calendarRouteHeaders }
  );
}
