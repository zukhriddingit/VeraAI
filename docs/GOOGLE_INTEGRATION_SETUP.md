# Google integration setup

Status: founder-release configuration and verification checklist
Reviewed: 2026-07-22

## Boundary

Vera uses two separate Google Web Application OAuth clients:

| Client      | Purpose                          | Scopes                                                                           |
| ----------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Identity    | Sign in to Vera                  | `openid`, `email`, `profile`                                                     |
| Integration | User-enabled Google capabilities | `openid`, `email`, plus exactly one incremental Gmail or Calendar scope per authorization |

The integration flow requests `https://www.googleapis.com/auth/calendar.freebusy` only when the user enables conflict checking. It requests `https://www.googleapis.com/auth/calendar.events.owned` separately when the user enables or first uses hold creation. Event-write access is not needed to suggest viewing times.

The Gmail alert flow requests `https://www.googleapis.com/auth/gmail.readonly` only when the user intentionally connects listing-alert ingestion. It searches only the configured Vera label/senders/subject terms, imports through the same immutable ingestion pipeline, and stores only the external message ID/history marker needed for idempotency. Gmail content is not part of OAuth persistence. No Gmail send or mailbox-modification method exists.

Do not add broad Calendar access, `calendar.readonly`, `calendar.events`, or `calendar.calendarlist.readonly` for the founder release. Vera checks only the connected account's primary calendar and must not claim that it checked other calendars.

The deterministic demo injects `MockCalendarClient`, needs no Google credentials, and makes no Google network request. Never enable mock fallback in hosted development, staging, or production.

## Google Cloud configuration

Create separate Google Cloud projects or fully isolated OAuth clients for development, staging, and production. For each environment:

1. Enable the Google Calendar API and, only for environments testing alert ingestion, the Gmail API.
2. Configure the OAuth consent screen with Vera's accurate application name, support contact, homepage, privacy policy, terms, and authorized domains.
3. Create a **Web application** OAuth client for Google integration. Do not use a Desktop/installed-app client for the hosted application.
4. Add only the exact callbacks for enabled capabilities. Local development uses:

   ```text
   http://127.0.0.1:3000/api/integrations/google/calendar/callback
   http://127.0.0.1:3000/api/integrations/google/gmail/callback
   ```

5. Use an exact HTTPS callback on a verified domain in staging and production. Paths, scheme, host, port, and trailing slash must match Vera's configured URI exactly.
6. Add test users while the consent screen is in testing. Never use an account containing sensitive production mailbox or calendar data for development.

Vera's server-side authorization-code flow uses a random, single-use, 10-minute state, PKCE S256, `access_type=offline`, and `include_granted_scopes=true`. It verifies the returned subject, audience, and actual granted scopes. Partial consent enables only the capability Google actually granted.

## Environment configuration

Set secrets through the environment's secret manager, never in a committed file:

```sh
export VERA_PUBLIC_BASE_URL=http://127.0.0.1:3000
export VERA_GOOGLE_INTEGRATION_CLIENT_ID=your-development-web-client-id
export VERA_GOOGLE_INTEGRATION_CLIENT_SECRET=your-development-web-client-secret
export VERA_GOOGLE_INTEGRATION_REDIRECT_URI=http://127.0.0.1:3000/api/integrations/google/calendar/callback
export VERA_GOOGLE_TIMEOUT_MS=5000
export VERA_CREDENTIAL_KEY_ID=development-1
export VERA_CREDENTIAL_KEYS_JSON='{"development-1":"REPLACE_WITH_A_BASE64_32_BYTE_KEY"}'
```

Generate a development key locally with `openssl rand -base64 32`. Do not paste the resulting key into chat, logs, screenshots, commits, or shared documentation. The selected key ID must exist in the JSON map and decode to exactly 32 bytes. Production keys belong in managed secret storage; retain old keys during a reviewed re-encryption rotation until no envelope references them.

All three `VERA_GOOGLE_INTEGRATION_*` values must be configured together. Leaving all three absent marks Calendar unconfigured; a partial configuration fails startup. `VERA_PUBLIC_BASE_URL` must be an exact origin, and production requires HTTPS.

For local hosted development:

```sh
pnpm postgres:up
DATABASE_URL=postgresql://vera:vera_dev_only@127.0.0.1:5432/vera pnpm db:migrate
pnpm dev
```

Then sign in and open **Settings -> Integrations**. Connect Gmail listing alerts, Calendar conflict checking, and Calendar hold creation separately; each flow verifies the exact scope Google granted.

## Data use and deletion

Conflict checking calls Google free/busy for `primary` only. Vera does not fetch event titles, descriptions, attendees, locations, conferencing, or other event details. It does not persist raw busy intervals; it stores a bounded check summary with state, check time, calendar IDs attempted/checked, response hash/count, safe error code, and Vera-rule provenance.

Refresh tokens and OAuth PKCE verifiers are encrypted with AES-256-GCM before PostgreSQL persistence. Access tokens remain short-lived and out of browser persistent storage. Logs and audit events must not contain tokens, codes, client secrets, Gmail message content, raw busy intervals, or provider response bodies.

Disconnect first attempts to revoke the Google grant and then clears Vera's encrypted credential material. If provider revocation cannot be confirmed, Vera still clears the local token and shows an audited manual-revocation recovery action. A safe disconnected record may remain where foreign-key history requires it; it contains no usable token. Encrypted backup copies remain governed by the documented retention and deletion policy.

Refresh and disconnect/revocation acquire the same short, tenant-owned PostgreSQL integration lease. This prevents the web and worker from concurrently rotating or revoking one refresh token. The network call occurs outside a database transaction; the owner-predicated lease is released in `finally`, and an expired lease is safely reclaimable after a crashed process. Contention returns a typed retry/reconnect state rather than making a second provider call.

The complete export, deletion, disconnect, backup, and provider-outage behavior is documented in [`PRIVACY_OPERATIONS.md`](./PRIVACY_OPERATIONS.md). The founder release has no self-service account deletion; that is an explicit multi-user beta blocker.

## Availability and hold guarantees

- A successful check is labeled **Checked against your primary Google Calendar** and records when it occurred.
- Missing, denied, expired, or revoked free/busy access falls back visibly to Vera's weekly rules and says **Calendar conflicts not checked**.
- A timeout or transient Google failure is `google_temporarily_unavailable`, never an empty calendar; the user may retry or continue only with a visible warning.
- Immediately before hold creation, Vera rechecks the selected interval. A new conflict creates no event and offers replacement windows.
- If the final check cannot complete, continuing requires a new exact approval that includes the warning and override reason.
- A created event is deterministic, private, and tentative, has no attendees or conferencing, and uses `sendUpdates=none`.
- Founder-release cancel and reschedule update Vera's state only. The user changes or deletes the Google event manually.

## Google verification readiness

Google Cloud Console is authoritative for each scope's current classification. Gmail `gmail.readonly` is a restricted scope and public production use can require verification and an annual security assessment; Calendar data scopes are sensitive and can require sensitive-scope verification. Plan verification lead time before launch.

Prepare the following before submitting:

- accurate consent-screen branding, application name, support contact, and developer contact;
- verified production domains and exact authorized redirect URIs;
- publicly reachable HTTPS homepage, privacy policy, and terms that match Vera's actual data use;
- a clear account-disconnect, token-revocation, local deletion, and backup-retention explanation;
- the minimum exact scope list, with separate justifications for primary-calendar conflict checking and private tentative hold creation;
- a verification video that shows Gmail alert enablement and bounded data use, primary-calendar-only free/busy, visible rules-only fallback, exact hold approval, created event, disconnect, and absence of email sends or attendee notifications;
- development/staging/production client separation and test-user configuration;
- evidence that Vera does not request event contents for availability, does not persist raw busy intervals, and exposes no Calendar event update/delete path in this release.

Suggested scope justifications:

- `calendar.freebusy`: intersect the user's explicit weekly availability with busy/free status from only their primary calendar; Vera does not read event content.
- `calendar.events.owned`: create an attendee-free, private, tentative viewing hold on the user's primary calendar only after exact human approval.
- `gmail.readonly`: read only configured listing-alert messages or the dedicated Vera label to import minimal listing facts; Vera does not modify the mailbox or send mail.

Review the official [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth), [OAuth production compliance policy](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [verification requirements](https://support.google.com/cloud/answer/13464321), and [submission guide](https://support.google.com/cloud/answer/13461325) before submitting.

## Production checklist

- [ ] Identity and integration use different Web Application clients.
- [ ] Development, staging, and production use different clients, secrets, callbacks, databases, and encryption keys.
- [ ] Production public base URL and callback are exact HTTPS values on verified domains.
- [ ] Only the enabled capability's incremental scope appears in the authorization request.
- [ ] Granted scopes are inspected after every callback and after token refresh.
- [ ] Refresh tokens and PKCE verifiers are encrypted with an active, versioned application key.
- [ ] Logs, tracing, error reporting, and analytics redact OAuth and Calendar data.
- [ ] Disconnect and revoked-token recovery have been exercised.
- [ ] Database backup, restore, migration `0001`, and encryption-key rotation have been rehearsed.
- [ ] `pnpm verify:calendar-boundaries`, tests, typecheck, lint, and build pass.
- [ ] Consent-screen configuration and verification evidence match the deployed behavior.
