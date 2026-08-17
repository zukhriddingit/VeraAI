import { getHostedApplication } from "../../../../../lib/server/application.ts";
import {
  AuthenticationRequiredError,
  requireVeraSession
} from "../../../../../lib/server/session.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff"
};

export async function GET(request: Request): Promise<Response> {
  try {
    const application = getHostedApplication();
    const session = await requireVeraSession(request.headers, application);
    if (application.privacyLifecycle === null) {
      return Response.json(
        { code: "privacy_unavailable", message: "Privacy export is unavailable." },
        { status: 503, headers: jsonHeaders }
      );
    }
    const bytes = await application.privacyLifecycle.exportOwner({
      userId: session.userId,
      generatedAt: new Date().toISOString()
    });
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": 'attachment; filename="vera-data-export.ndjson"',
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error: unknown) {
    if (error instanceof AuthenticationRequiredError) {
      return Response.json(
        { code: "unauthorized", message: "Authentication required." },
        { status: 401, headers: jsonHeaders }
      );
    }
    if (error instanceof Error && /exceeds the allowed (?:line|total) size/iu.test(error.message)) {
      return Response.json(
        { code: "export_too_large", message: "Privacy export exceeds the supported size." },
        { status: 413, headers: jsonHeaders }
      );
    }
    return Response.json(
      { code: "privacy_unavailable", message: "Privacy export is unavailable." },
      { status: 503, headers: jsonHeaders }
    );
  }
}
