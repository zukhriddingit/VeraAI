# Railway Web Service Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Vera's real authenticated PostgreSQL-backed web application to Railway Free through a dedicated web-only image, while Maritime retains the worker and browser execution remains disabled.

**Architecture:** Add a digest-pinned multi-stage `Dockerfile.web` that builds and packages only `@vera/web`, then bind Railway to it through config-as-code. Add a focused static verifier and CI image build so Railway cannot silently select the root worker Dockerfile again.

**Tech Stack:** Node.js 24.13.0, pnpm 11.14.0, Next.js 16.2.10, TypeScript 6.0.3, Vitest 4.1.10, Docker BuildKit, Railway CLI 5.30.1.

## Global Constraints

- The Railway service is the real authenticated application, never the deterministic SQLite demo.
- Keep the repository-root `Dockerfile` as the immutable Maritime worker image.
- Run only the Next.js web process in Railway.
- Keep managed PostgreSQL canonical and require `DATABASE_URL`.
- Keep browser execution disabled; do not deploy an OpenClaw Gateway.
- Do not add product features or change authentication, integration, database, or worker semantics.
- Do not copy `.env*` files or secrets into Git, build arguments, image layers, logs, or fixtures.
- Do not change the separate Vercel landing-page deployment.
- Remain on Railway Free; target less than approximately 450 MB steady-state RSS after sign-in.
- Merge through green CI and deploy only the exact merged `main` commit.

---

## File map

- Create `Dockerfile.web`: build and runtime contract for the Railway web service.
- Create `scripts/verify-web-image-boundaries.ts`: pure static deployment-boundary validator and repository entry point.
- Create `scripts/verify-web-image-boundaries.unit.test.ts`: table-driven regression tests for Dockerfile and Railway drift.
- Modify `package.json`: expose `verify:web-image-boundaries`.
- Modify `railway.toml`: select `Dockerfile.web` and the web-only start command.
- Modify `.github/workflows/ci.yml`: run the verifier and build the web image.
- Modify `README.md`: document the exact web/worker image split.
- Modify `docs/ARCHITECTURE.md`: record the Railway web-only runtime boundary.

---

### Task 1: Add the web-image boundary verifier

**Files:**
- Create: `scripts/verify-web-image-boundaries.ts`
- Create: `scripts/verify-web-image-boundaries.unit.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Dockerfile.web` text and `railway.toml` text.
- Produces: `findWebImageBoundaryViolations(input): string[]`.
- Produces: root command `pnpm verify:web-image-boundaries`.

- [ ] **Step 1: Write the failing table-driven unit tests**

Create `scripts/verify-web-image-boundaries.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { findWebImageBoundaryViolations } from "./verify-web-image-boundaries.ts";

const nodeImage =
  "node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f";

const validDockerfile = `FROM ${nodeImage} AS build
RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @vera/web build
RUN pnpm --filter @vera/web deploy --legacy --prod /opt/vera-web
FROM ${nodeImage} AS runtime
COPY --from=build --chown=vera:vera /opt/vera-web ./
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
    ["missing readiness", validDockerfile.replace("/api/ready", "/api/health")],
    ["environment copy", `${validDockerfile}\nCOPY .env.local /app/.env.local\n`]
  ])("rejects %s", (_name, dockerfile) => {
    expect(
      findWebImageBoundaryViolations({ dockerfile, railwayConfig: validRailway })
    ).not.toEqual([]);
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run --project unit scripts/verify-web-image-boundaries.unit.test.ts
```

Expected: FAIL because `verify-web-image-boundaries.ts` does not exist.

- [ ] **Step 3: Implement the pure verifier and repository entry point**

Create `scripts/verify-web-image-boundaries.ts`:

```ts
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const NODE_IMAGE =
  "node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f";

export function findWebImageBoundaryViolations(input: {
  readonly dockerfile: string;
  readonly railwayConfig: string;
}): string[] {
  const violations: string[] = [];
  const fromLines = input.dockerfile.match(/^FROM\s+\S+/gmu) ?? [];

  if (fromLines.length !== 2 || fromLines.some((line) => line !== `FROM ${NODE_IMAGE}`)) {
    violations.push("Every web-image stage must use the exact immutable Node image digest.");
  }
  if (!input.dockerfile.includes("corepack prepare pnpm@11.14.0 --activate")) {
    violations.push("The web image must use exact pnpm 11.14.0.");
  }
  if (!input.dockerfile.includes("pnpm install --frozen-lockfile")) {
    violations.push("The web image must install only from the frozen lockfile.");
  }
  if (
    !input.dockerfile.includes("pnpm --filter @vera/web build") ||
    !input.dockerfile.includes(
      "pnpm --filter @vera/web deploy --legacy --prod /opt/vera-web"
    )
  ) {
    violations.push("The image must build and package only the production web workspace.");
  }
  if (/@vera\/worker|openclaw|demo-start|VERA_DEMO_MODE/iu.test(input.dockerfile)) {
    violations.push("The Railway web image must not build or start worker, browser, or demo code.");
  }
  if (/COPY\s+[^\n]*\.env/iu.test(input.dockerfile)) {
    violations.push("The web image must not copy environment files.");
  }
  if (!/^USER\s+vera\s*$/mu.test(input.dockerfile)) {
    violations.push("The web runtime must use the non-root vera user.");
  }
  if (
    !input.dockerfile.includes("/api/ready") ||
    !input.dockerfile.includes("process.env.PORT")
  ) {
    violations.push("The web image must check readiness on its injected runtime port.");
  }
  if (
    !input.dockerfile.includes(
      'CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]'
    )
  ) {
    violations.push("The web image must start only the hosted Next.js process.");
  }

  if (!/^\s*builder\s*=\s*"DOCKERFILE"\s*$/mu.test(input.railwayConfig)) {
    violations.push("Railway must use the Dockerfile builder.");
  }
  if (!/^\s*dockerfilePath\s*=\s*"Dockerfile\.web"\s*$/mu.test(input.railwayConfig)) {
    violations.push("Railway must select Dockerfile.web.");
  }
  if (/^\s*buildCommand\s*=/mu.test(input.railwayConfig)) {
    violations.push("Railway must not override the Dockerfile build command.");
  }
  if (
    !/^\s*startCommand\s*=\s*"node node_modules\/next\/dist\/bin\/next start --hostname 0\.0\.0\.0"\s*$/mu.test(
      input.railwayConfig
    ) ||
    /worker|openclaw|demo/iu.test(input.railwayConfig)
  ) {
    violations.push("Railway must start only the hosted Next.js process.");
  }
  if (!/^\s*healthcheckPath\s*=\s*"\/api\/ready"\s*$/mu.test(input.railwayConfig)) {
    violations.push("Railway must retain /api/ready as the release health gate.");
  }

  return violations;
}

async function main(): Promise<void> {
  const [dockerfile, railwayConfig] = await Promise.all([
    readFile(new URL("../Dockerfile.web", import.meta.url), "utf8"),
    readFile(new URL("../railway.toml", import.meta.url), "utf8")
  ]);
  const violations = findWebImageBoundaryViolations({ dockerfile, railwayConfig });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Railway web image boundaries validated.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) await main();
```

- [ ] **Step 4: Add the root verification command**

Add to `package.json` scripts:

```json
"verify:web-image-boundaries": "tsx scripts/verify-web-image-boundaries.ts"
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
pnpm vitest run --project unit scripts/verify-web-image-boundaries.unit.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the verifier**

```bash
git add package.json scripts/verify-web-image-boundaries.ts scripts/verify-web-image-boundaries.unit.test.ts
git commit -m "test: guard Railway web image boundary"
```

---

### Task 2: Build the dedicated production web image

**Files:**
- Create: `Dockerfile.web`

**Interfaces:**
- Consumes: monorepo lockfile and `@vera/web` workspace.
- Produces: non-root image command `node node_modules/next/dist/bin/next start --hostname 0.0.0.0`.

- [ ] **Step 1: Create the multi-stage web Dockerfile**

Create `Dockerfile.web`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.14.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/package.json
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

COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @vera/web build
RUN pnpm --filter @vera/web deploy --legacy --prod /opt/vera-web \
  && rm -rf /opt/vera-web/.next /opt/vera-web/public \
  && cp -R apps/web/.next /opt/vera-web/.next \
  && cp -R apps/web/public /opt/vera-web/public

FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS runtime

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

RUN groupadd --system --gid 10001 vera \
  && useradd --system --uid 10001 --gid vera --home-dir /app vera

COPY --from=build --chown=vera:vera /opt/vera-web ./

USER vera
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT??'3000';fetch('http://127.0.0.1:'+port+'/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
```

- [ ] **Step 2: Run the new static boundary gate**

Run:

```bash
pnpm verify:web-image-boundaries
```

Expected before Task 3: FAIL only because `railway.toml` has not yet selected the new file.

- [ ] **Step 3: Build the image locally**

Run:

```bash
docker build --pull --file Dockerfile.web --tag vera-web:local .
```

Expected: the Next.js production build and production-only deploy complete.

- [ ] **Step 4: Inspect immutable runtime metadata**

Run:

```bash
docker image inspect vera-web:local \
  --format '{{json .Config.User}} {{json .Config.Cmd}} {{json .Config.Healthcheck.Test}}'
```

Expected: user `vera`, Next.js-only command, and `/api/ready` health check.

- [ ] **Step 5: Commit the web image**

```bash
git add Dockerfile.web
git commit -m "build: add Railway web service image"
```

---

### Task 3: Bind Railway to the web image and document the split

**Files:**
- Modify: `railway.toml`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: `Dockerfile.web`.
- Produces: deterministic Railway build and start selection.

- [ ] **Step 1: Replace the Railpack ambiguity**

Set `railway.toml` to:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile.web"

[deploy]
startCommand = "node node_modules/next/dist/bin/next start --hostname 0.0.0.0"
healthcheckPath = "/api/ready"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

- [ ] **Step 2: Document the exact production image boundary**

In `README.md` under `Deployment assumptions`, add:

```markdown
Railway is bound through `railway.toml` to `Dockerfile.web`, which builds and
starts only `@vera/web`. The repository-root `Dockerfile` remains the Maritime
worker image. Do not point the Railway web service at the root Dockerfile and do
not run `pnpm worker:start`, demo bootstrap, or OpenClaw in the public web
container.
```

In `docs/ARCHITECTURE.md` under `Deployment`, add:

```markdown
The image boundary is explicit: Railway uses `Dockerfile.web` for the public
Next.js process, while Maritime uses the root `Dockerfile` for the private
worker. Browser execution and the dedicated Gateway remain absent from the
founder-core web image.
```

- [ ] **Step 3: Run focused configuration validation**

Run:

```bash
pnpm verify:web-image-boundaries
pnpm vitest run --project unit scripts/verify-web-image-boundaries.unit.test.ts
git diff --check
```

Expected: all PASS.

- [ ] **Step 4: Commit Railway config and documentation**

```bash
git add railway.toml README.md docs/ARCHITECTURE.md
git commit -m "fix: bind Railway to the web image"
```

---

### Task 4: Make the image build a required CI signal

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `Dockerfile.web` and `pnpm verify:web-image-boundaries`.
- Produces: `Build Railway web image` CI job.

- [ ] **Step 1: Run the static verifier in the main verify job**

Immediately after `Verify web runtime boundaries`, add:

```yaml
      - name: Verify Railway web image boundaries
        run: pnpm verify:web-image-boundaries
```

- [ ] **Step 2: Add the Docker build job**

Add:

```yaml
  web_image:
    name: Build Railway web image
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    permissions:
      contents: read

    steps:
      - name: Check out repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Configure Docker Buildx
        uses: docker/setup-buildx-action@4d04d5d9486b7bd6fa91e7baf45bbb4f8b9deedd # v4.0.0

      - name: Build Railway web image
        uses: docker/build-push-action@f9f3042f7e2789586610d6e8b85c8f03e5195baf # v7.2.0
        with:
          context: .
          file: Dockerfile.web
          pull: true
          load: true
          push: false
          tags: vera-web:ci

      - name: Verify web-only runtime metadata
        shell: bash
        run: |
          set -euo pipefail
          test "$(docker image inspect vera-web:ci --format '{{.Config.User}}')" = "vera"
          docker image inspect vera-web:ci --format '{{json .Config.Cmd}}' |
            grep -F 'node_modules/next/dist/bin/next'
          docker image inspect vera-web:ci --format '{{json .Config.Healthcheck.Test}}' |
            grep -F '/api/ready'
```

- [ ] **Step 3: Run the affected local suite**

Run:

```bash
pnpm format:check
pnpm verify:web-runtime-boundaries
pnpm verify:web-image-boundaries
pnpm lint
pnpm typecheck
pnpm vitest run --project unit \
  scripts/verify-web-runtime-boundaries.unit.test.ts \
  scripts/verify-web-image-boundaries.unit.test.ts
pnpm --filter @vera/web build
git diff --check
```

Expected: all PASS.

- [ ] **Step 4: Review the diff for scope and secrets**

Run:

```bash
git diff --stat
git diff --check
git status --short
git diff | rg -n 'API_KEY|SECRET|TOKEN|DATABASE_URL=|NEXT_PUBLIC_'
```

Expected: only synthetic variable names in documentation/tests; no values,
untracked evidence, environment files, worker behavior, or browser enablement.

- [ ] **Step 5: Commit CI enforcement**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build Railway web image"
```

---

### Task 5: PR, merge, Railway Free deployment, and live acceptance

**Files:**
- No new source files.
- Remote actions: GitHub PR and existing Railway `vera` service only.

**Interfaces:**
- Consumes: exact merged commit from the green PR.
- Produces: healthy YC-facing Railway application on the existing public domain.

- [ ] **Step 1: Run the complete pre-push gate**

Run:

```bash
pnpm format:check
pnpm verify:web-runtime-boundaries
pnpm verify:web-image-boundaries
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm --filter @vera/web build
docker build --pull --file Dockerfile.web --tag vera-web:release-candidate .
git diff --check
git status --short
```

Expected: all checks PASS and the worktree is clean.

- [ ] **Step 2: Push and open the CI-gated PR**

Run:

```bash
git push --set-upstream origin codex/railway-web-service
gh pr create \
  --base main \
  --head codex/railway-web-service \
  --title "fix: deploy Railway with the web-only image" \
  --body-file /tmp/vera-railway-web-pr-body.md
```

The PR body must state:

- real authenticated service, not demo mode;
- Railway `Dockerfile.web` versus Maritime root `Dockerfile`;
- current Free-plan constraint;
- browser execution remains disabled;
- exact local validation;
- no secrets or product behavior changes; and
- live Railway memory acceptance remains pending until merge.

- [ ] **Step 3: Wait for exact-head CI and merge only when green**

Run:

```bash
gh pr checks --watch
gh pr view --json mergeable,mergeStateStatus,headRefOid,statusCheckRollup
gh pr merge --squash --delete-branch \
  --subject "fix: deploy Railway with the web-only image"
```

Expected: all required checks pass and GitHub reports the PR mergeable before
the squash merge.

- [ ] **Step 4: Resolve the exact merged main commit**

Run:

```bash
git fetch origin main
git rev-parse origin/main
git merge-base --is-ancestor 9595e3d22c34fa663d8bf0a82c9eb542e6b28ace origin/main
```

Expected: a new immutable `main` SHA and ancestor check exit code 0.

- [ ] **Step 5: Link and inspect Railway without printing variables**

Run from a clean checkout of the merged SHA:

```bash
pnpm dlx @railway/cli@5.30.1 login
pnpm dlx @railway/cli@5.30.1 link
pnpm dlx @railway/cli@5.30.1 status
```

Select the existing project and the existing public `vera` web service. Do not
run any variables command that prints values.

- [ ] **Step 6: Deploy the exact merged source**

Run:

```bash
pnpm dlx @railway/cli@5.30.1 up --service vera --detach
```

Expected: Railway reports `Dockerfile.web` as the selected source. If it reports
the root `Dockerfile`, cancel immediately and do not let the worker image start.

- [ ] **Step 7: Verify public readiness and real application routes**

Run:

```bash
curl --fail --silent --show-error \
  https://vera-production-f19c.up.railway.app/api/ready
curl --fail --silent --show-error --output /dev/null \
  https://vera-production-f19c.up.railway.app/sign-in
```

Expected: readiness 200 and sign-in route 200. Then manually verify:

1. Google sign-in;
2. authenticated inbox;
3. source-status page;
4. no demo banner or fixture-mode claim;
5. browser controls remain absent or disabled; and
6. no 502 or restart during the flow.

- [ ] **Step 8: Inspect memory and decide without upgrading**

Use Railway metrics for landing, sign-in, inbox, and source-status. Record only
sanitized timestamps and RSS values.

Acceptance: steady-state RSS remains below approximately 450 MB with no
out-of-memory event. If the service approaches or exceeds the 0.5 GB ceiling,
stop the deployment acceptance and collect sanitized diagnostics. Do not switch
to Hobby automatically.

- [ ] **Step 9: Report the release**

Report:

- PR URL and merged `main` SHA;
- Railway deployment identifier and final status;
- public readiness result;
- authenticated route checks;
- memory peak and steady-state range;
- confirmation that the worker remained on Maritime;
- confirmation that browser execution remained disabled;
- confirmation that no paid plan change occurred; and
- rollback status or remaining blocker.
