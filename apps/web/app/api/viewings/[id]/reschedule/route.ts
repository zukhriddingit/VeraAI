import { RescheduleViewingRequestSchema, RescheduleViewingResponseSchema } from "@vera/domain";

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

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const service = await calendarRouteService(request);
    assertSameOriginMutation(request);
    const id = parseRouteEntityId((await context.params).id);
    if (id === null) throw new SyntaxError("Invalid Viewing identifier.");
    const input = RescheduleViewingRequestSchema.parse(await readCalendarMutationJson(request));
    const result = await service.reschedule({ viewingId: id, ...input });
    return Response.json(RescheduleViewingResponseSchema.parse(result), {
      status: 201,
      headers: calendarRouteHeaders
    });
  } catch (error: unknown) {
    return calendarRouteError(error);
  }
}
