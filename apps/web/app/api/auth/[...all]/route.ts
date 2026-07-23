import { getHostedApplication } from "../../../../lib/server/application.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const application = getHostedApplication();
  if (application.mode !== "hosted" || application.auth === null) {
    return Response.json({ code: "not_found", message: "Not found." }, { status: 404 });
  }
  return application.auth.handler(request);
}

export const GET = handle;
export const POST = handle;
