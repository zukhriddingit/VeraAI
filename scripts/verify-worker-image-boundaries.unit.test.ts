import { describe, expect, it } from "vitest";

import { findWorkerImageViolations } from "./verify-worker-image-boundaries.ts";

const image =
  "node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f";

const validDockerfile = `FROM ${image} AS build
RUN pnpm --filter @vera/worker deploy --legacy --prod /opt/vera-worker
RUN find /opt/vera-worker/node_modules -type l -lname '*better-sqlite3*' -delete \\
  && rm -rf /opt/vera-worker/node_modules/.pnpm/better-sqlite3@12.11.1
FROM ${image} AS runtime
ENV VERA_OPENCLAW_EXECUTABLE=/workspace/apps/worker/node_modules/.bin/openclaw
COPY --from=build /opt/vera-worker apps/worker
USER vera
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health')"]
`;

describe("worker image boundaries", () => {
  it("accepts the immutable non-root lockfile composition", () => {
    expect(
      findWorkerImageViolations({
        dockerfile: validDockerfile,
        workerBuild:
          'const require = __veraCreateRequire(import.meta.url); external: ["better-sqlite3", "pg", "pino", "sharp"]',
        workerPackage: {
          dependencies: { openclaw: "2026.6.33", pg: "8.22.0", sharp: "0.35.3" }
        },
        lockfile: "openclaw@2026.6.33: {}",
        workspace: "allowBuilds:\n  openclaw: false\n"
      })
    ).toEqual([]);
  });

  it("rejects mutable images and a runtime global install", () => {
    const violations = findWorkerImageViolations({
      dockerfile: `FROM node:24.13.0-bookworm-slim AS build
FROM node:24.13.0-bookworm-slim AS runtime
RUN npm install --global openclaw@latest
USER root
`,
      workerBuild: "external: []",
      workerPackage: { dependencies: {} },
      lockfile: "",
      workspace: "allowBuilds: {}"
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("immutable Node image digest"),
        expect.stringContaining("global OpenClaw installation"),
        expect.stringContaining("mutable latest"),
        expect.stringContaining("non-root vera"),
        expect.stringContaining("healthcheck"),
        expect.stringContaining("lockfile-installed OpenClaw"),
        expect.stringContaining("must depend on exact openclaw"),
        expect.stringContaining("exact pg runtime"),
        expect.stringContaining("exact sharp runtime"),
        expect.stringContaining("lockfile must resolve"),
        expect.stringContaining("lifecycle scripts"),
        expect.stringContaining("production-only worker deployment"),
        expect.stringContaining("remove demo-only SQLite"),
        expect.stringContaining("CommonJS runtime packages external"),
        expect.stringContaining("Node createRequire")
      ])
    );
  });
});
