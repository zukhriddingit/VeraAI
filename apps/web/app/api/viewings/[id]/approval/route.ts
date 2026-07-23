import { randomUUID } from "node:crypto";

import {
  ApproveCalendarHoldRequestSchema,
  ApproveCalendarHoldResponseSchema,
  CalendarHoldPreviewResponseSchema,
  CreateCalendarHoldPreviewRequestSchema
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
    const input = CreateCalendarHoldPreviewRequestSchema.parse(
      await readCalendarMutationJson(request)
    );
    const result = await service.createPreview({ viewingId: await viewingId(context), ...input });
    return Response.json(CalendarHoldPreviewResponseSchema.parse(result), {
      status: 201,
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
    const input = ApproveCalendarHoldRequestSchema.parse(await readCalendarMutationJson(request));
    const result = await service.approvePreview({
      viewingId: await viewingId(context),
      holdId: input.holdId,
      expectedPayloadHash: input.expectedPayloadHash,
      correlationId: randomUUID()
    });
    return Response.json(ApproveCalendarHoldResponseSchema.parse(result), {
      status: 200,
      headers: calendarRouteHeaders
    });
  } catch (error: unknown) {
    return calendarRouteError(error);
  }
}
