# EOD live Maritime OpenClaw rental-search demo

## What this demo proves

An authenticated, allowlisted founder can run one bounded, read-only rental search:

```text
Vera search profile
  -> RentCast long-term rental listings (maximum 10 active records)
  -> private OpenClaw agent chat on Maritime
  -> immutable RawListing evidence
  -> Vera normalization and deterministic decision workers
  -> listing cockpit and append-only activity log
```

RentCast supplies inventory. OpenClaw supplies separately labeled qualitative notes. Vera's
deterministic hard constraints, scores, source policy, persistence, and user-controlled actions
remain authoritative. This path uses no browser node, browser extension, public webhook, public
OpenClaw gateway, Gmail mutation, Calendar mutation, landlord contact, or fixture fallback.

## Required accounts and local prerequisites

- One RentCast Developer account and dedicated Vera API key.
- One Maritime account, one dedicated OpenClaw agent, and one server-integration API key.
- Node.js 24, pnpm, Docker, and PostgreSQL as documented in the repository README.
- One real Better Auth Vera user UUID on the founder allowlist.
- One real SearchProfile already owned by that user. The current P0 has no hosted
  search-profile editor; do not substitute the sanitized demo profile.

## Maritime setup

Run these operator commands from a normal terminal. They are not application startup commands:

```bash
npm install --global maritime-cli@1.7.0
maritime login
maritime whoami

maritime create vera-live-search-agent \
  --template openclaw \
  --always-on

maritime deploy vera-live-search-agent \
  --source docker \
  --image ghcr.io/openclaw/openclaw@sha256:99546785a121ccac065263d4b609c3dc08a396d260b20c837722e7998be0a6ee \
  --wait

maritime keys create \
  --name vera-live-search-demo \
  --scopes manage \
  --json
```

Use the narrowest chat-capable scope the installed CLI exposes. If it exposes no chat-specific
scope, the dedicated `manage` demo key above is temporary: revoke it after recording. The key
command returns the API-key record's identity as well as the secret. Neither is the OpenClaw
agent ID. Obtain the agent ID from `maritime info vera-live-search-agent --json` or the creation
result. Never paste either secret into chat, GitHub, logs, screenshots, or client-side variables.

The application uses Maritime's authenticated
`POST /api/agents/{agent_id}/chat` API. It does not use the public webhook URL. Configure the
agent's LLM and provider credential in Maritime's private agent configuration. The fixed Vera
prompt requests no browser, message, calendar, file, shell, or payment tools.

## Local server environment

Put real values in the server process environment or the gitignored workspace-root `.env.local`,
set mode `0600`, and load it into the terminal that starts both web and worker processes. Do not
add `NEXT_PUBLIC_` to any key below.

```dotenv
RENTCAST_API_KEY=
MARITIME_API_KEY=
MARITIME_OPENCLAW_AGENT_ID=

VERA_LIVE_AGENT_SEARCH_ENABLED=1
VERA_LIVE_AGENT_FOUNDER_USER_IDS=replace-with-exact-vera-user-uuid
VERA_INTEGRATIONS_DISABLED=0
VERA_LIVE_AGENT_TIMEOUT_MS=30000
VERA_LIVE_AGENT_MAX_RESPONSE_BYTES=100000
VERA_LIVE_AGENT_PROMPT_VERSION=vera-live-rental-analysis.v1
VERA_RENTCAST_TIMEOUT_MS=12000
VERA_RENTCAST_MAX_RESPONSE_BYTES=1000000
```

The normal hosted variables remain required, including `DATABASE_URL`, Better Auth configuration,
and `VERA_PUBLIC_BASE_URL`. Keep `VERA_BROWSER_DISABLED=1`. Do not configure or start
`OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, or a local OpenClaw node for this demo.

Hosted environments must supply both API keys through their restricted server-side secret store,
not a checked-in environment file.

## PostgreSQL and application startup

```bash
pnpm install
pnpm postgres:up
pnpm db:migrate
pnpm db:seed
chmod 600 .env.local
set -a
source .env.local
set +a
pnpm dev
```

`pnpm db:seed` installs reviewed source-policy manifests only. It intentionally creates no user,
session, search profile, listing, or activity evidence. Sign in through Vera and confirm the
founder user already owns exactly the real profile intended for the recording.

## Live smoke test

The opt-in test is skipped unless every live value is present. In addition to the server values,
set:

```dotenv
VERA_RUN_LIVE_FOUNDER_SEARCH_TESTS=1
VERA_LIVE_TEST_USER_ID=replace-with-founder-user-uuid
VERA_LIVE_TEST_PROFILE_ID=replace-with-owned-profile-id
```

Then run:

```bash
pnpm test:live:founder-search
```

This consumes real RentCast and Maritime capacity and persists the returned records. It prints no
key and no raw provider response.

## UI recording path

1. Open `http://127.0.0.1:3000/` and sign in as the allowlisted founder.
2. Select the real active profile in **Founder-only live inventory**.
3. Check the confirmation that live RentCast and Maritime usage will occur.
4. Select **Run live agent search** once.
5. Show queued, retrieving, analyzing, importing, and completed state changes.
6. Show the persistent banner: **Live results — RentCast inventory analyzed by OpenClaw on
   Maritime.**
7. On a live card, point out **Real data · RentCast**, provider freshness, **Vera fit score**, and
   the separate **OpenClaw agent notes**.
8. Open `/activity` and show the request, provider, agent, import, normalization, and final
   deterministic-scoring events under one correlation ID.

The status panel intentionally shows the safe label `OpenClaw on Maritime`, not the agent ID.

## CLI recording fallback

The CLI invokes the same application service and persists to the same PostgreSQL database:

```bash
pnpm live-search:founder -- --profile <owned-profile-id>
```

If more than one founder UUID is allowlisted, also pass `--user <founder-user-uuid>`. The output is
limited to the search-run ID, safe state, and retrieved/imported/rejected counts.

## 75–100 second video script

1. **0–12 seconds:** “Vera is a renter-controlled housing copilot. This is a signed-in founder
   account with a real search profile—location, budget, bedrooms, move-in timing, pets, and explicit
   preferences.”
2. **12–25 seconds:** Show the confirmation and click **Run live agent search**. “This makes one
   bounded read-only RentCast request for at most ten active rentals. No scraper or local browser
   agent is running.”
3. **25–40 seconds:** Show retrieving and analyzing. “Candidate facts are minimized before Vera
   sends them to our private OpenClaw agent through Maritime's authenticated chat API. Keys,
   contacts, cookies, and unrelated user data never enter the prompt.”
4. **40–62 seconds:** Show the completed banner and live cards. “The card separates Vera's
   deterministic fit score from OpenClaw's qualitative notes. The model can summarize strengths,
   watchouts, and missing facts, but it cannot change constraints, policy, or scores.”
5. **62–82 seconds:** Shortlist one result, then open Activity. “The provider observation is
   immutable and idempotently imported through Vera's normal normalization and decision pipeline.
   Every material step is auditable without storing secrets or contact details.”
6. **82–95 seconds:** “This milestone is founder-only and browser-disabled. It proves a real
   provider-to-agent-to-cockpit loop; broader browser ingress, multi-user beta, outreach, and
   production deployment remain gated.”

## Safe and prohibited claims

Safe claims:

- “Live active rental inventory came from RentCast's official read-only API.”
- “OpenClaw ran on Maritime and analyzed only the supplied minimized candidates.”
- “Vera's deterministic logic remained authoritative.”
- “The path is founder-only, bounded, browser-disabled, and fail-closed.”
- “The activity log records safe hashes, counts, latency, versions, and outcomes.”

Do not claim:

- complete, exclusive, or real-time market coverage;
- that any listing, landlord, or neighborhood is safe, legitimate, or fraud-free;
- autonomous browsing, contacting, scheduling, applying, or payment;
- production readiness, a browser-enabled beta, or a multi-user beta;
- that model notes replace renter verification or deterministic policy.

## Troubleshooting

- **RentCast authentication:** `provider_auth_failed` means the server-side key is missing,
  invalid, expired, or not entitled. Correct the secret locally; never copy it into an issue or
  screenshot.
- **Maritime authentication:** `maritime_unavailable` after a 401/403 usually means the dedicated
  key is invalid, revoked, or lacks chat access. Verify the key and agent ownership with the CLI
  without printing the key.
- **Agent timeout:** `agent_timeout` preserves existing data and imports nothing from that run.
  Verify agent health and configured LLM, then use the single safe retry.
- **No results:** `no_matching_live_results` is not converted into fixture success. Confirm the
  explicit profile city/state or ZIP and constraints before another billable request.
- **Rate limiting:** `provider_rate_limited` does not automatically paginate or retry. Wait for
  provider capacity or quota and then explicitly retry.
- **Invalid agent response:** `agent_invalid_response` means JSON, run identity, candidate IDs,
  bounds, or language policy failed. Vera rejects the response and does not mock an answer.

## Retention and shutdown

The accepted provider projection is stored as immutable raw evidence under Vera's existing data
retention boundary. Contact phone numbers and emails are discarded before persistence. After the
recording, turn `VERA_LIVE_AGENT_SEARCH_ENABLED` back to `0`, revoke any temporary broad Maritime
demo key, and leave browser execution disabled.
