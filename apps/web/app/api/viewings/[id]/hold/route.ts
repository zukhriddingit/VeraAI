import {
  CreateApprovedCalendarHoldRequestSchema,
  CreateApprovedCalendarHoldResponseSchema,
  CreateConflictCheckOverrideRequestSchema,
  CreateConflictCheckOverrideResponseSchema
} from "@vera/domain";

import {
  calendarRouteError,
  calendarRouteHeaders,
  calendarRouteService,
  readCalendarMutationJson
} from "../../../../../lib/calendar-hold-route-support.ts";
import { parseRouteEntityId } from "../../../../../lib/route-entity-id.ts";
import { assertSameOriginMutation } from "../../../../../lib/server/request-security.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

async function viewingId(context: RouteContext): Promise<string> {
  const id = parseRouteEntityId((await context.params).id);
  if (id === null) throw new SyntaxError("Invalid Viewing identifier.");
  return id;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const service = await calendarRouteService(request);
    assertSameOriginMutation(request);
    const input = CreateApprovedCalendarHoldRequestSchema.parse(
      await readCalendarMutationJson(request)
    );
    const result = await service.createApprovedHold({
      viewingId: await viewingId(context),
      ...input
    });
    return Response.json(CreateApprovedCalendarHoldResponseSchema.parse(result), {
      status: result.kind === "created" ? 201 : 409,
      headers: calendarRouteHeaders
    });
  } catch (error: unknown) {
    return calendarRouteError(error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const service = await calendarRouteService(request);
    assertSameOriginMutation(request);
    const input = CreateConflictCheckOverrideRequestSchema.parse(
      await readCalendarMutationJson(request)
    );
    const result = await service.createOverridePreview({
      viewingId: await viewingId(context),
      ...input
    });
    return Response.json(CreateConflictCheckOverrideResponseSchema.parse(result), {
      status: 201,
      headers: calendarRouteHeaders
    });
  } catch (error: unknown) {
    return calendarRouteError(error);
  }
}
