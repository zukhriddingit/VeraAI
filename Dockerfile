# syntax=docker/dockerfile:1.7
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/calendar/package.json packages/calendar/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY packages/scoring/package.json packages/scoring/package.json
COPY packages/testing/package.json packages/testing/package.json
RUN pnpm install --frozen-lockfile

COPY apps/worker apps/worker
COPY packages packages
RUN pnpm --filter @vera/worker build
RUN pnpm --filter @vera/worker deploy --legacy --prod /opt/vera-worker
# Drizzle's optional-peer resolution can copy the demo-only SQLite package into
# pnpm's hidden store even though the production worker cannot import it.
RUN find /opt/vera-worker/node_modules -type l -lname '*better-sqlite3*' -delete \
  && rm -rf /opt/vera-worker/node_modules/.pnpm/better-sqlite3@12.11.1 \
    /opt/vera-worker/node_modules/.pnpm/@types+better-sqlite3@7.6.13

FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS runtime

ENV NODE_ENV=production
ENV VERA_OPENCLAW_EXECUTABLE=/workspace/apps/worker/node_modules/.bin/openclaw
WORKDIR /workspace

RUN groupadd --system --gid 10001 vera \
  && useradd --system --uid 10001 --gid vera --home-dir /workspace vera

COPY --from=build --chown=vera:vera /opt/vera-worker apps/worker

USER vera
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/worker/dist/index.js", "serve"]
