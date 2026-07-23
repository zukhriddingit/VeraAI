import { DemoUnavailableResponseSchema } from "@vera/domain";

import { getActivityCollection } from "../../../lib/listing-presentation";
import { AuthenticationRequiredError, requireVeraSession } from "../../../lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0", "Content-Type": "application/json" };

export async function GET(request: Request): Promise<Response> {
  try {
    const context = await requireVeraSession(request.headers);
    return Response.json(await getActivityCollection(context.repositories), {
      status: 200,
      headers
    });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers }
      );
    }
    return Response.json(
      DemoUnavailableResponseSchema.parse({
        code: "demo_unavailable",
        message: "Activity history is unavailable."
      }),
      { status: 503, headers }
    );
  }
}
