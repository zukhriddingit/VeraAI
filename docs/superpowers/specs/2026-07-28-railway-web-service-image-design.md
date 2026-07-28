# Railway Web Service Image Design

## Status

Approved for implementation on 2026-07-28.

## Context

Vera's YC-facing hosted application is a real authenticated service backed by
managed PostgreSQL. It is not the deterministic SQLite demo. The merged
Google-integration lazy-loading repair at source commit
`9595e3d22c34fa663d8bf0a82c9eb542e6b28ace` removes eager Calendar and Gmail
runtime loading when integrations are disabled.

The remaining Railway failure is a build-boundary error. Railway detects the
repository-root `Dockerfile` before honoring the existing Railpack intent. That
Dockerfile intentionally builds the private Vera worker for Maritime and starts
the worker health server on port 8080. It is not a web image and cannot serve
the public Next.js application.

Railway's Free plan is the current deployment target. It provides 0.5 GB RAM
per service and $1 of monthly included usage. Vera must attempt the correct,
web-only image and measure live memory before considering a paid plan.

## Goal

Build and deploy one dedicated Railway image that runs only the authenticated
Next.js web application, uses managed PostgreSQL, preserves the integration
lazy-loading repair, and leaves the worker and browser execution planes
disabled or external.

The existing public Railway domain should serve the real application for YC
reviewers. It must not enter demo mode or display fixture-backed behavior as a
live service.

## Non-goals

- Do not run the Vera worker in the Railway web service.
- Do not move the Maritime worker back to Railway.
- Do not enable or deploy an OpenClaw Gateway or browser connector.
- Do not add browser discovery, navigation, messaging, or application behavior.
- Do not change PostgreSQL schemas, authentication semantics, integrations, or
  product features.
- Do not change or redeploy the separate Vercel marketing landing page.
- Do not upgrade Railway to Hobby or another paid plan during this repair.
- Do not copy `.env` files or credentials into the image or build context.

## Considered approaches

### 1. Dedicated web Dockerfile selected in config-as-code

Add `Dockerfile.web`, leave the root worker `Dockerfile` unchanged, and bind
Railway to the new file through `railway.toml`.

This is the selected approach. It gives each execution plane an explicit image,
keeps the reviewed worker supply chain stable, and prevents Railway dashboard
drift from selecting the worker image again.

### 2. Rename the root worker Dockerfile

Rename the root file to `Dockerfile.worker` and let Railway use Railpack.

This is rejected because the worker release workflow, image-boundary
validators, documentation, and immutable release process intentionally use the
root Dockerfile. Renaming it creates a larger and riskier release change.

### 3. Set only `RAILWAY_DOCKERFILE_PATH` in the dashboard

Point the current service at a custom file through a Railway variable.

This is rejected as the durable fix because it leaves the deployment boundary
outside version control. The variable may be used only as an emergency
diagnostic if Railway fails to apply the committed config-as-code.

## Architecture

```text
YC reviewer
  -> existing Railway public HTTPS domain
  -> Dockerfile.web image
  -> one Next.js production process
  -> managed PostgreSQL

Maritime
  -> immutable Vera worker image from root Dockerfile

Browser execution
  -> disabled and absent from this release
```

The Railway image has one responsibility: serve the web application. It has no
worker command, scheduler, OpenClaw executable, browser gateway, or demo
bootstrap.

## `Dockerfile.web`

The web image must:

1. Use the repository's digest-pinned Node 24 base and exact pnpm 11.14.0.
2. Install from the committed lockfile with `--frozen-lockfile`.
3. copy only the package manifests needed for workspace dependency resolution
   before dependency installation;
4. copy `apps/web` and the workspace packages required by `@vera/web`;
5. run `pnpm --filter @vera/web build`;
6. create a production deployment for `@vera/web` with workspace dependencies;
7. copy only that production deployment into the runtime stage;
8. run as a dedicated non-root UID/GID;
9. bind Next.js to `0.0.0.0` and Railway's injected `PORT`;
10. expose port 3000 as image metadata without assuming Railway's runtime port;
11. provide a container health check against `/api/ready`; and
12. start the Next.js production server directly with Node.

No build argument or image layer may contain runtime secrets. Runtime
configuration is injected by Railway only after the image is built.

The runtime may contain dependencies required for later-enabled Gmail or
Calendar behavior, but the merged lazy loaders must keep those providers
unloaded while integrations are disabled.

## Railway config-as-code

`railway.toml` must explicitly select:

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile.web"
```

The deploy section must retain:

- `/api/ready` as the readiness path;
- a 300-second health-check timeout;
- bounded failure restarts; and
- an explicit web-only Next.js start command compatible with the runtime
  layout.

The existing Railpack `buildCommand` must be removed because the Dockerfile owns
the build. The committed configuration must override any stale dashboard build
selection.

Database migration remains a controlled release step. It must not be hidden in
the web container's startup command.

## Safety boundaries

- `VERA_DEMO_MODE` must remain absent in Railway.
- `DATABASE_URL` remains mandatory; hosted composition must fail rather than
  fall back to SQLite.
- Browser variables and Gateway credentials remain absent or disabled.
- `VERA_BROWSER_DISABLED=1` remains the accepted hosted state.
- Integrations remain fail-closed according to their existing configuration.
- No `.env*`, OAuth secret, database URL, API key, cookie, or credential file
  enters Git, a Docker layer, logs, or test fixtures.
- The root worker Dockerfile and its release validators remain unchanged unless
  a boundary test needs to distinguish it from `Dockerfile.web`.

## Tests and static verification

Add deployment-boundary tests that fail if:

- `Dockerfile.web` is missing;
- Railway does not select `Dockerfile.web`;
- Railway selects the root worker Dockerfile;
- the web image starts the worker, OpenClaw, or demo bootstrap;
- the image lacks a non-root runtime user;
- the image uses a mutable base image or wrong pnpm version;
- the web build is not lockfile-frozen;
- the readiness path changes from `/api/ready`;
- the image copies `.env` files; or
- the public service start command is not Next.js.

Run:

- the focused deployment-boundary tests;
- the web-runtime boundary verifier;
- lint and formatting checks;
- typecheck;
- the complete unit suite affected by deployment configuration;
- a production Next.js build; and
- a local `docker build -f Dockerfile.web`.

The built container must also be inspected to confirm its configured user,
entry command, health check, and absence of a worker/OpenClaw start command.

## Delivery and live acceptance

The repair must use a normal CI-gated pull request into `main`. Railway may be
retried only from the merged source commit.

Live acceptance is:

1. Railway reports the committed `Dockerfile.web` as its build source.
2. The build and deployment succeed on the Free plan.
3. `/api/ready` returns success on the existing public domain.
4. The landing page, sign-in, authenticated inbox, and source-status page load.
5. No worker or browser process is present in the web container.
6. With integrations disabled, the sign-in and dashboard flow remains below
   approximately 450 MB steady-state RSS, leaving headroom under the 0.5 GB
   service ceiling.
7. There are no repeated restarts, 502 responses, or out-of-memory events
   during the YC review flow.

If memory exceeds the Free-plan ceiling, stop and collect sanitized metrics.
Do not upgrade automatically. A second, evidence-based memory repair or an
explicit paid-plan decision is required.

## Failure and rollback

Railway must keep the previous healthy deployment active until the new health
check passes. If build, readiness, authentication, or memory acceptance fails:

1. stop the failed deployment;
2. retain sanitized logs and memory observations;
3. roll back to the last healthy web deployment when one exists;
4. do not redirect the public domain to the Vercel marketing site; and
5. do not weaken readiness, authentication, database, integration, or browser
   safety gates to make the deployment pass.

## Future browser work

The later founder-browser release may add a separately reviewed browser
connector and dedicated OpenClaw Gateway. It must not be preloaded into this
web-only repair. Its image, credentials, transport, pairing, and release gate
remain independent from the YC-facing founder-core web deployment.
