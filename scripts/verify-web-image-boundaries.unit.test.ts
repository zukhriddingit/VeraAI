import { describe, expect, it } from "vitest";

import { findWebImageBoundaryViolations } from "./verify-web-image-boundaries.ts";

const nodeImage =
  "node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f";

const validDockerfile = `FROM ${nodeImage} AS build
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vera/web build
RUN ! grep -R -q -E 'pg-[0-9a-f]{16}' apps/web/.next/server
RUN pnpm --filter @vera/web deploy --legacy --prod /opt/vera-web
FROM ${nodeImage} AS runtime
COPY --from=build --chown=vera:vera /opt/vera-web ./
COPY --from=build /workspace/packages/db/drizzle /packages/db/drizzle
RUN test -f /packages/db/drizzle/meta/_journal.json
USER vera
EXPOSE 3000
HEALTHCHECK CMD ["node", "-e", "const port=process.env.PORT??'3000';fetch('http://127.0.0.1:'+port+'/api/ready')"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
`;

const validRailway = `[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile.web"

[deploy]
startCommand = "node node_modules/next/dist/bin/next start --hostname 0.0.0.0"
healthcheckPath = "/api/ready"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
`;

describe("Railway web image boundaries", () => {
  it("accepts the immutable, non-root, web-only composition", () => {
    expect(
      findWebImageBoundaryViolations({
        dockerfile: validDockerfile,
        railwayConfig: validRailway
      })
    ).toEqual([]);
  });

  it.each([
    ["mutable image", validDockerfile.replaceAll(`@sha256:${nodeImage.split("@sha256:")[1]}`, "")],
    ["worker build", validDockerfile.replace("@vera/web build", "@vera/worker build")],
    ["demo startup", validDockerfile.replace("next/dist/bin/next", "scripts/demo-start.ts")],
    ["root runtime", validDockerfile.replace("USER vera", "USER root")],
    ["unfrozen install", validDockerfile.replace(" --frozen-lockfile", "")],
    [
      "missing pg external guard",
      validDockerfile.replace("RUN ! grep -R -q -E 'pg-[0-9a-f]{16}' apps/web/.next/server\n", "")
    ],
    [
      "missing PostgreSQL migration journal",
      validDockerfile.replace(
        "COPY --from=build /workspace/packages/db/drizzle /packages/db/drizzle",
        "COPY --from=build /workspace/packages/db/drizzle /packages/db/missing"
      )
    ],
    ["missing readiness", validDockerfile.replace("/api/ready", "/api/health")],
    ["environment copy", `${validDockerfile}\nCOPY .env.local /app/.env.local\n`]
  ])("rejects %s", (_name, dockerfile) => {
    expect(findWebImageBoundaryViolations({ dockerfile, railwayConfig: validRailway })).not.toEqual(
      []
    );
  });

  it.each([
    ["Railpack", validRailway.replace('"DOCKERFILE"', '"RAILPACK"')],
    ["worker Dockerfile", validRailway.replace("Dockerfile.web", "Dockerfile")],
    ["worker start", validRailway.replace("next start", "worker start")],
    ["wrong readiness", validRailway.replace("/api/ready", "/api/health")],
    ["hidden build override", `${validRailway}\nbuildCommand = "pnpm build"\n`]
  ])("rejects Railway drift: %s", (_name, railwayConfig) => {
    expect(
      findWebImageBoundaryViolations({ dockerfile: validDockerfile, railwayConfig })
    ).not.toEqual([]);
  });
});
