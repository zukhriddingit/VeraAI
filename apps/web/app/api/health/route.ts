import { createHealthReport } from "@vera/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(): Response {
  const report = createHealthReport({
    service: "vera-web",
    version: process.env.npm_package_version ?? "0.1.0",
    now: new Date(),
    nodeVersion: process.versions.node
  });

  return Response.json(report, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
