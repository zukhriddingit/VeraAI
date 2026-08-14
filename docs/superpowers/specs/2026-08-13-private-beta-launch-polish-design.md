# Private Beta Launch Polish Design

Status: Approved for written review
Date: 2026-08-13

## Purpose

Prepare Vera for its first small group of real testers without presenting the founder-only browser
experiment as a public production capability.

This launch stage fixes the obsolete Railway demo links, preserves and refines the existing Vera
marketing identity, adds a public sanitized product demo, introduces an email-only private-beta
intake and invite gate, and prepares the existing Chrome extension for private Chrome Web Store
review. Browser-enabled onboarding remains deliberately smaller than Store distribution: the Store
may include up to 25 invited Google accounts, while the first active browser wave is limited to
three to five people and cannot begin until user-isolated Gateway routing is proven.

The launch promise remains:

> Find fast. Rent safely.

## Confirmed baseline

The current production and repository state establishes the following constraints:

- `https://verahousing.app` is the Vercel marketing site and
  `https://www.verahousing.app` redirects to the apex.
- `https://app.verahousing.app` is the Heroku product. Its unauthenticated root redirects to
  `/sign-in`, while `/api/ready` is the production readiness gate.
- The marketing page still sends all demo calls to the removed Railway deployment at
  `https://vera-production-f19c.up.railway.app/`.
- The atlas/coral landing page source and sanitized marketing captures exist in historical commit
  `d578f76d92e6390f002072ee1a8924e4c2d50d11`, but not on current `main`. They must be imported
  deliberately; the stale working tree containing them is not a release source.
- The landing page uses instant anchor jumps. Its hero motion is concentrated in long-running atlas
  animations and does not give later sections a coherent motion rhythm.
- The product's existing `/demo` implementation is authenticated and repository-backed. It must not
  be exposed as the public demo because it can reach application state and mutation routes.
- The existing Manifest V3 extension is version `2.0.3`, uses exactly `debugger`, `tabs`,
  `tabGroups`, `storage`, and `alarms`, declares no host permissions, and preserves exactly one
  explicitly shared tab as the user-visible consent boundary.
- The extension readiness bridge includes the obsolete Vercel origin and marketing origins but does
  not include `https://app.verahousing.app/*`.
- PostgreSQL browser-node records are already tenant-scoped, but the accepted live browser path is
  not multi-user: one global Gateway agent, one exact founder checkpoint identity, and one relay
  credential are selected from environment configuration.
- Production browser integrations are currently disabled fail-closed. The signed Gateway image and
  the accepted four-source behavior must not be rebuilt or weakened for this launch work.

## Decisions

### Canonical application surfaces

Vera will use two independently deployed Next.js applications from one current repository branch:

```text
https://verahousing.app
  -> Vercel
  -> apps/marketing
  -> public marketing, browser-connector privacy, support, and launch content

https://app.verahousing.app
  -> Heroku
  -> apps/web
  -> public sanitized demo and beta request pages
  -> invite-gated authenticated product
  -> PostgreSQL-backed private renter data
```

`apps/marketing` becomes the canonical source for the Vercel project. It is created by carefully
porting the existing atlas landing page, its focused components, and its sanitized image assets from
the historical marketing commit. It does not import product repositories, authentication, database
drivers, connector code, or browser credentials.

The alternatives are rejected:

- Keeping marketing on a stale deployment branch preserves the drift that caused the dead Railway
  link.
- Serving marketing and the authenticated product from one hostname or deployment couples public
  page releases to the database-backed product and complicates authentication and rollback.

The canonical calls to action are:

- **Explore demo** -> `https://app.verahousing.app/demo`
- **Join private beta** -> `https://app.verahousing.app/beta`
- **Sign in** -> `https://app.verahousing.app/sign-in`

No built source, rendered link, test, metadata file, or deployment configuration may retain the old
Railway application URL. The legacy Vercel project URL may remain a platform alias but is not shown
to users and is not an approved extension readiness origin.

### Public demo boundary

`/demo` is a public, read-only, product-shaped walkthrough. It uses versioned sanitized fixtures
bundled with the web build and renders without a session, PostgreSQL query, source connector,
browser bridge, worker, LLM, or mutation API.

The demo shows the real Vera interaction model:

1. a sanitized search profile;
2. discovered source records becoming canonical homes;
3. source badges and duplicate evidence;
4. explainable fit factors;
5. missing facts and risk indicators;
6. a listing detail view with photos or honest placeholders, costs, availability, source links, and
   provenance; and
7. an activity history explaining which steps would require approval.

Demo interactions such as filtering, selecting a listing, and opening evidence are client-local.
Any shortlist, draft, calendar, search, refresh, connector, or browser control is either absent or
clearly labeled as a non-persistent demonstration. The demo makes no `fetch` call to a product API,
sets no Vera session cookie, reads no production user data, and creates no audit or database row.

A persistent banner states: “Sanitized demo — no marketplace, email, calendar, or browser actions
occur.” Source URLs in fixtures use reserved or inert example destinations rather than live landlord
or marketplace records. The page does not claim that a demo action contacted anyone or changed a
real account.

### Marketing refinement, not redesign

The visual system remains recognizable as the current Vera site:

- dark navy atlas composition;
- coral action color;
- current Vera mark and typography;
- existing sanitized product captures; and
- the present editorial, evidence-first tone.

The rejected concept thumbnails do not influence implementation. This stage improves behavior and
hierarchy rather than replacing the composition, palette, typography, or imagery.

The hero keeps one primary promise and three clear actions. The page then tells a tighter launch
story: acquisition, normalized evidence, renter control, private beta, and browser-connector trust.
Claims distinguish currently available behavior from experimental browser behavior. The Chrome
extension is described as a private-beta browser connector, not a production-supported public
marketplace integration.

Motion follows these rules:

- in-page anchors scroll smoothly with a sticky-header offset;
- browser history and focus move to the selected section so keyboard and assistive-technology users
  receive the same navigation result;
- the active navigation item reflects the section intersecting beneath the header;
- content sections reveal once with small opacity and vertical-transform transitions;
- the atlas may respond subtly to a fine pointer, but pointer motion cannot obscure text, move the
  proof card over the target, or create layout shift;
- long-running atlas motion pauses while the hero is outside the viewport or the document is hidden;
- animations use transform and opacity only, with no scroll hijacking and no heavy animation
  dependency; and
- `prefers-reduced-motion: reduce` makes anchors immediate, removes parallax and auto-running motion,
  and renders every section in its final visible state.

The sticky navigation remains compact on desktop and becomes a deliberate mobile header rather than
an overflowing row. Every section has `scroll-margin-top` matching the actual header height. Focus
rings remain visible against both dark and coral surfaces.

### Email-only beta intake

`/beta` asks for exactly one user-supplied field: email address. It includes an unchecked consent
control confirming that Vera may contact the person about the private beta, a short privacy link,
and no application questionnaire, housing details, phone number, password, OAuth grant, or payment.

The same-origin `POST /api/beta-access` route:

- accepts bounded JSON only;
- applies a strict email schema and Unicode-safe normalization;
- requires the current consent version and an unfilled honeypot;
- rate-limits without retaining raw IP addresses;
- stores one idempotent request per normalized email;
- returns the same accepted response for a new or repeated request;
- never reveals whether an email is already a Vera user or invited tester; and
- never provisions an account, sends email, creates a Store tester, or issues a pairing credential.

PostgreSQL adds two narrow records:

```text
beta_access_requests
  id
  normalized_email (unique)
  status: requested | invited | declined | withdrawn
  consent_version
  consented_at
  requested_at
  reviewed_at
  reviewed_by_user_id

beta_memberships
  normalized_email (unique)
  user_id (unique, nullable until first approved sign-in)
  status: invited | active | revoked
  invited_at
  activated_at
  revoked_at
  approved_by_user_id
```

Free-form reviewer notes are intentionally omitted to avoid accumulating unnecessary personal data.
The rate limiter stores only a short-lived HMAC digest derived with a dedicated server-only key and
a trusted client-network value; it never stores or logs a raw address. Operational logs contain a
request ID, outcome code, and timing, not the submitted email.

An authenticated `/settings/beta` queue is restricted by an exact server-side beta-admin UUID
allowlist. The founder may mark a request invited, declined, or withdrawn. Approval creates or
updates the matching membership but performs no outreach; the founder contacts and schedules the
tester manually. Repeated review operations are idempotent and audited without placing the email in
audit metadata.

### Invite-gated product identity

Google identity and private-beta authorization remain separate checks.

Before the gate is enabled in production, the current founder's existing user row receives an
active beta membership in a verified transaction. New Google identities may be created only when
the provider returns a verified email matching an invited membership. Every protected page and API
then requires an active membership in addition to the valid Better Auth session. Revoked or absent
membership yields the same generic access-pending experience and no tenant repository access.

On the first approved sign-in, Vera binds the membership to the newly created user UUID. The binding
is unique in both directions and exact-email based. A user cannot select an owner, reuse another
person's invitation, or turn a submitted beta request into access. Revocation invalidates existing
sessions and denies future protected requests.

The public `/demo`, `/beta`, beta submission endpoint, sign-in assets, health, and readiness routes
remain intentionally public. Product data routes remain authenticated and invite-gated.

### Chrome Web Store private-beta package

The Store item is named **Vera Browser Connector BETA**. Its first description begins with:

> THIS EXTENSION IS FOR BETA TESTING. Vera Browser Connector lets an approved Vera tester explicitly
> share one dedicated housing-search tab with their paired Vera Browser Gateway.

Its single purpose is to create and revoke that one explicit shared-tab connection. The extension
does not contain an LLM, autonomously search, contact anyone, type credentials, solve blockers, or
grant Vera product access. A Vera server workflow may request bounded read-only research only after
the authenticated tester triggers it and all policy gates pass.

The runtime permissions remain exactly:

- `debugger` to attach to the one tab the tester explicitly shares and relay bounded Chrome DevTools
  Protocol messages required by the reviewed OpenClaw transport;
- `tabs` to identify, prepare, and revoke that exact tab;
- `tabGroups` to keep shared status visibly represented by the dedicated OpenClaw group;
- `storage` to retain only the paired relay endpoint, scoped connection credential, and group color
  on the tester's device; and
- `alarms` for bounded relay reconnection and readiness maintenance.

No host permissions, optional host permissions, arbitrary scripting, `chrome.scripting`, cookies,
downloads, history, identity, web-request interception, externally connectable surface, or web
accessible resources are added. The readiness bridge runs only on loopback development origins and
`https://app.verahousing.app/*`; the obsolete Vercel and marketing origins are removed.

The popup retains Vera's existing consent controls but makes the data boundary prominent before
sharing:

- exactly one tab will be shared;
- the tab URL and observed page content needed for housing research may be processed;
- cookies, saved passwords, browser storage, authenticated headers, and full-page screenshots are
  not listing output;
- Contact, Apply, Tour, Reply, Message, Email, Phone, payment, upload, and download controls are
  forbidden; and
- unsharing stops future tab access while unpairing removes the local relay credential and closes
  the connection.

“Share this tab with Vera” is the affirmative consent action. The prepared-tab flow remains the
recommended path. Pairing is available only after manual approval and concierge onboarding. Each
active tester receives a fresh credential for their own isolated Gateway; no credential is embedded
in the package, Store metadata, web page, email list, source tree, logs, or screenshots.

The package adds PNG icons at 16, 32, 48, and 128 pixels and declares them for the extension and
toolbar action. Store material includes an actual 1280x800 product screenshot, a 440x280 promotional
image, concise permission justifications, accurate data-use declarations, support URL, homepage URL,
privacy URL, and reviewer instructions. Assets must show the real extension and Vera product, not a
concept UI that the product does not provide.

Distribution is **Private — trusted testers** with deferred publishing. Private visibility still
receives the normal Chrome Web Store policy review. The initial trusted-tester list contains the
founder and required reviewer/test accounts; approved beta emails are added manually. After review
succeeds, the marketing browser-connector section and approved-tester onboarding page may link to
the Store item as **Install browser connector — approved testers**. The primary public CTA remains
“Join private beta” because an unapproved Google account cannot install a private item. Before
review succeeds, no Store URL is rendered anywhere public.

### Browser-connector privacy and support

`https://verahousing.app/privacy/browser-connector` is public and linked from the marketing footer,
beta page, extension popup, and Store dashboard. It accurately discloses:

- data observed locally and data transmitted to Vera;
- the single-tab, user-triggered purpose;
- local connection-credential storage;
- secure HTTPS/WSS transmission;
- server retention of imported listing facts and audit-safe metadata;
- excluded credentials, cookies, headers, storage, passwords, and screenshots;
- service providers necessary to operate Vera;
- no advertising, sale, creditworthiness use, or unrelated transfer;
- the limited circumstances in which a human may inspect specifically consented support evidence;
- access, correction, deletion, unpairing, and support procedures; and
- the Chrome Web Store Limited Use statement required by current policy.

The policy cannot promise that consumer sites never show login, 2FA, CAPTCHA, consent, checkpoint,
rate-limit, or layout-change blockers. It explains that Vera stops and asks the tester to handle
those steps manually.

The support page provides a dedicated support email and a compact troubleshooting sequence: verify
approved Vera access, verify pairing, prepare exactly one dedicated tab, confirm Browser ready,
unshare, and unpair. It never asks a tester to send a password, cookie, pairing credential, browser
profile, raw page snapshot, or authenticated header. Debug support uses safe status codes and only
user-selected evidence.

Chrome Web Store requirements are tracked against the official documentation for
[private trusted-tester distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution),
[user data and Limited Use](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
[listing assets](https://developer.chrome.com/docs/webstore/images), and
[reviewer instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions).

### Active tester isolation gate

Store installation does not authorize browser use. The first active browser cohort is blocked until
a separate security implementation proves a user-to-Gateway assignment boundary. That follow-on
slice must use the existing signed Gateway image unless a concrete missing bounded primitive is
demonstrated.

The required logical model is:

```text
approved Vera user
  -> exact browser-beta UUID allowlist
  -> active beta membership
  -> user-owned browser node and profile approval
  -> one user-owned Gateway assignment
  -> one distinct relay credential and checkpoint credential
  -> one explicitly shared tab
```

A Gateway assignment stores only non-secret routing identity and credential hashes in PostgreSQL.
Raw relay, checkpoint, Maritime, and plan-signing secrets remain in the approved runtime secret
store. Server services resolve the Gateway agent from the authenticated user assignment; they do not
fall back to the founder's global Gateway. The checkpoint authenticates the calling assignment,
derives its user, and then resolves the signed run only inside that user's repositories. A token for
one assignment cannot authorize, inspect, or advance another user's run.

The current `VERA_BROWSER_GATEWAY_FOUNDER_USER_ID` single-user behavior and global
`MARITIME_BROWSER_GATEWAY_AGENT_ID` selection cannot be broadened by adding more UUIDs alone. Until
the assignment resolver, checkpoint identity, revocation, and cross-user tests pass, non-founder
members receive product access without browser activation and the UI says the Browser Connector is
waiting for onboarding.

Wave 1 activates only three to five testers. Expansion to at most 25 invited testers requires:

- ten completed user-triggered browser sessions across at least three non-founder testers;
- correct user isolation in every dispatch, checkpoint, import, and audit record;
- immediate unshare and unpair revocation in live acceptance;
- zero forbidden browser actions;
- zero credential, cross-user, or unexpected-background-execution incidents;
- no regression in the existing four-source founder flow; and
- seven consecutive days without a severity-one or severity-two browser safety incident.

Manual login, 2FA, CAPTCHA, consent, checkpoint, rate limits, unexpected redirects, and changed
layouts remain typed manual or source failures and are not counted as safety failures when Vera
stops correctly.

## Release sequence

The launch is delivered in four reversible slices:

1. **Marketing and public demo.** Add canonical `apps/marketing`, deploy it to Vercel, add the
   static `/demo`, repair every CTA, and verify production domains. This slice changes no identity,
   database, extension, Gateway, or browser flag.
2. **Private-beta intake and authorization.** Add the email-only request, protected review queue,
   memberships, and invite gate. Seed and verify the founder membership before enforcing the gate.
3. **Store review package.** Update the reviewed extension origins and disclosures, add real assets,
   publish the privacy/support pages, produce a deterministic ZIP and hashes, and submit privately
   with deferred publishing. No public Store link is shown before approval.
4. **Browser-enabled cohort.** Complete the separate user-isolated routing security slice, activate
   three to five people through concierge onboarding, run live revocation acceptance, and expand
   only after the stability criteria pass.

The first three slices may ship while production browser integrations remain disabled. Store review
or installation must never be used as evidence that browser activation is safe.

Implementation planning is intentionally decomposed into four plans matching these release slices.
Each plan must produce independently testable software and pass its own rollback gate. The
browser-enabled cohort plan cannot start merely because the first three plans finish; its assignment
boundary and live-evidence prerequisites remain separate authorization gates.

## Failure handling

- A marketing deployment failure leaves the previous Vercel deployment active and does not affect
  the Heroku product.
- `/demo` always renders its local sanitized data. It cannot silently fall back to PostgreSQL or a
  production user's records.
- A failed beta database write shows a retryable failure; it does not falsely claim the request was
  recorded. Duplicate valid requests return the same successful acknowledgement.
- An uninvited or revoked identity receives the generic access-pending page and no tenant repository
  access. Error text does not reveal whether a submitted email exists.
- A missing beta-admin configuration makes every review mutation deny. It never creates an open
  admin route.
- An unpaired, offline, stale, revoked, multiply shared, or unapproved browser node returns its
  existing visible safe state. It does not queue hidden background work.
- Store rejection leaves the item private and the site on “Join private beta.” The package is fixed
  and resubmitted; the public site never links to a rejected or draft item.
- Unsharing immediately removes future tab access. Unpairing removes the local credential, closes
  the connection, and marks the server assignment revoked through the approved revocation flow.
- Emergency response activates the existing global browser kill switch before revoking assignment
  credentials. PostgreSQL listing data is preserved.

## Testing and evidence

### Automated tests

- Marketing unit and Playwright tests verify the canonical CTAs, absence of Railway URLs, current
  atlas composition, sticky-offset anchors, active navigation, keyboard focus, mobile layout, and
  reduced-motion behavior.
- Public-demo tests verify HTTP 200 without a session, fixture-only data, no production repository
  calls, no external links to real listings, and no network or mutation request during interaction.
- PostgreSQL integration tests verify beta-request idempotency, consent persistence, unique
  membership binding, admin-only transitions, founder bootstrap, revocation, and lower-case email
  matching.
- Authentication tests prove that valid Google identity without active membership receives no
  repository, that an invitation cannot be claimed by a different email, and that revocation denies
  an existing session.
- Extension tests and `verify:vera-openclaw-extension` prove exact permissions, no host permissions,
  only reviewed readiness origins, one-tab consent, no forbidden APIs, safe local credential
  removal, and a release lock matching the deterministic package.
- Store-asset verification proves required PNG dimensions, manifest icons, ZIP root layout, package
  exclusions, description labeling, privacy/support URLs, and package SHA-256.
- Browser-assignment tests in the follow-on slice prove cross-user denials, no founder fallback,
  token-to-user checkpoint binding, idempotent revocation, and source failure isolation.

### Production and manual acceptance

- `https://verahousing.app` and `https://www.verahousing.app` serve the current marketing release
  with valid TLS and the expected redirect.
- Every Explore demo action opens `https://app.verahousing.app/demo`; no request reaches Railway.
- Section links move smoothly in ordinary motion mode and immediately in reduced-motion mode.
- `https://app.verahousing.app/demo` works in a clean browser with no authentication and creates no
  database changes.
- A new email request appears once in the founder queue, while an uninvited Google account cannot
  enter the product.
- The founder and one approved test identity can sign in without cross-user data exposure.
- The private Store package passes local unpacked-extension acceptance, Chrome Web Store review, and
  private install for an approved Google account.
- The extension prepares and shares exactly one tab, reports Browser ready, stops on unshare, and
  disconnects on unpair. Clipboard bytes are zero after onboarding.
- The activity evidence reports zero Contact, Apply, Tour, Reply, Message, Email, Phone, payment,
  upload, download, login, CAPTCHA-bypass, or other forbidden action.
- Existing RentCast, Zillow, Apartments.com, and Facebook source behavior remains intact for the
  founder acceptance path.

## Deployment and rollback

Marketing and product are deployed from the same reviewed commit but remain separate releases.
Vercel builds only `apps/marketing`; Heroku continues to release the paired `apps/web` and worker
images. `/api/ready` remains the Heroku release health gate.

Database migrations are additive and preserve every listing, provenance field, score, job, and
activity event. Rolling back web code leaves beta records inert; migrations are not destructively
reversed. Before enabling the invite gate, deployment evidence records the founder membership and a
successful founder sign-in.

The extension uses a monotonically increasing version and a deterministic release lock. Chrome Web
Store deferred publishing provides the rollback point before availability. After publishing, a bad
version is replaced by a higher fixed version or unpublished; an old package is never re-signed with
different contents under the same version.

The immutable accepted Gateway images are not rebuilt as part of marketing, demo, intake, or Store
packaging. Browser-enabled cohort work must first prove that a bounded primitive is missing before a
new Gateway image is considered, and any such change requires the existing signature, SBOM,
provenance, vulnerability, revocation, and forbidden-action gates.

## Definition of done

This launch design is complete when:

1. marketing has one canonical source on current `main` and the apex no longer contains any Railway
   application link;
2. the current Vera design is visibly preserved while anchors, motion, accessibility, and mobile
   behavior pass acceptance;
3. the sanitized public demo is useful without authentication and provably isolated from production
   data and side effects;
4. private-beta intake collects only email plus consent, and manual approval—not submission or
   Google identity alone—controls product access;
5. the browser privacy/support disclosures and Store listing accurately describe observed data,
   permissions, limitations, and revocation;
6. **Vera Browser Connector BETA** passes automated packaging checks and Chrome Web Store private
   review with deferred publishing;
7. approved testers receive the Store link and pairing only through concierge onboarding;
8. no non-founder browser activation occurs before the per-user assignment gate passes;
9. Wave 1 live evidence covers three to five isolated testers before expansion toward 25;
10. existing four-source behavior remains intact, forbidden-action count remains zero, and
    unsharing prevents future browser work; and
11. production product readiness, PostgreSQL data, the working Heroku release, and the signed
    Gateway boundary remain stable throughout the launch.
