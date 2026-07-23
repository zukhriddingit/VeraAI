import { randomUUID } from "node:crypto";

import {
  CreateViewingProposalsRequestSchema,
  CreateViewingProposalsResponseSchema
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

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const service = await calendarRouteService(request);
    assertSameOriginMutation(request);
    const listingId = parseRouteEntityId((await context.params).id);
    if (listingId === null) {
      throw new SyntaxError("Invalid listing identifier.");
    }
    CreateViewingProposalsRequestSchema.parse(await readCalendarMutationJson(request));
    const result = await service.proposeViewing({
      canonicalListingId: listingId,
      correlationId: randomUUID()
    });
    return Response.json(CreateViewingProposalsResponseSchema.parse(result), {
      status: 201,
      headers: calendarRouteHeaders
    });
  } catch (error: unknown) {
    return calendarRouteError(error);
  }
}
