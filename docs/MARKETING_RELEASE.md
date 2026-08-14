# Vera marketing release

Vera has two independently releasable application surfaces from the same reviewed repository
commit:

- `https://verahousing.app` and `https://www.verahousing.app`: Vercel project rooted at
  `apps/marketing`.
- `https://app.verahousing.app`: Heroku product from `apps/web` plus the paired worker.

The marketing deployment must never be used as a product or browser-readiness origin. The Heroku
release must never bundle or rebuild the hardened OpenClaw Gateway.

## Pre-merge gate

Run focused checks while iterating and one full CI run before merge:

```sh
pnpm verify:launch-surfaces
pnpm exec vitest run --project unit apps/web/app/demo apps/marketing scripts/verify-launch-surfaces.unit.test.ts
pnpm --filter @vera/web run build
pnpm --filter @vera/marketing run build
pnpm test:e2e:launch
```

The public demo must build as a static route and make no product API request. All marketing launch
links must resolve to `https://app.verahousing.app`.

## Vercel project settings

Deploy the current merged repository commit with these exact settings:

- Root Directory: `apps/marketing`
- Framework Preset: `Next.js`
- Install Command: `corepack enable && pnpm install --frozen-lockfile`
- Build Command: `pnpm run build`
- Output Directory: empty
- Production domains: `verahousing.app` and `www.verahousing.app`
- Redirect: permanent `www` to `https://verahousing.app`

Retain the previously promoted Vercel deployment URL until the production smoke is complete.

## Heroku product release

Follow the repository's paired Heroku web and worker release runbook. Apply migrations through the
release phase, then verify `https://app.verahousing.app/api/ready` before promotion. Do not change
DigitalOcean, Maritime, OpenClaw, extension pairing, Gateway containers, or PostgreSQL data as part
of a marketing release.

## Production smoke

```sh
curl -fsS https://app.verahousing.app/api/ready
curl -fsSI https://app.verahousing.app/demo
curl -fsS https://verahousing.app | rg -n 'app\.verahousing\.app/(demo|beta|sign-in)'
curl -fsSI https://www.verahousing.app
```

Acceptance requires a ready product, HTTP 200 for `/demo`, all three canonical launch destinations,
a permanent `www` redirect, and no obsolete Railway hostname in any response.

## Rollback

- Marketing failure: promote the retained previous Vercel deployment. Do not roll back Heroku.
- Product demo or readiness failure: roll back the paired Heroku web and worker release. Do not
  reverse PostgreSQL migrations or alter Gateway data.
- Record the merged commit, Heroku release ID, Vercel deployment ID, smoke timestamp, and response
  codes in private release evidence.
