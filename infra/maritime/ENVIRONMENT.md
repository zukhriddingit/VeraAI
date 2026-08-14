# Maritime environment manifest

Values live in environment-specific secret stores, never in Git. Development, staging, and production use separate credentials. The web application retains its own hosted secret configuration; this table covers Maritime services.

For `founder_core`, set `VERA_BROWSER_DISABLED=1` and do not define any remote-extension or legacy
browser-Gateway variable. Browser private-beta routing is a separate, fail-closed assignment path;
see `docs/BROWSER_BETA_OPERATIONS.md`. A core worker never selects a global browser Gateway.

## Vera worker

| Name                                         | Secret | Purpose                                                            |
| -------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `DATABASE_URL`                               | yes    | Canonical managed PostgreSQL connection.                           |
| `VERA_DB_POOL_MAX`                           | no     | Bounded founder worker pool size.                                  |
| `VERA_DB_CONNECTION_TIMEOUT_MS`              | no     | Connection timeout.                                                |
| `VERA_DB_STATEMENT_TIMEOUT_MS`               | no     | Statement timeout.                                                 |
| `VERA_DB_LOCK_TIMEOUT_MS`                    | no     | Lock timeout.                                                      |
| `VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS`        | no     | Idle transaction timeout.                                          |
| `VERA_MARITIME_WORKER_AGENT_ID`              | no     | Exact worker audience and deployment identifier.                   |
| `VERA_MARITIME_GATEWAY_AGENT_ID`             | no     | Browser-experimental gateway ID; forbidden for founder core.       |
| `VERA_MARITIME_ENVIRONMENT`                  | no     | `development`, `staging`, or `production`.                         |
| `MARITIME_API_KEY`                           | yes    | Narrow server runtime key for worker/gateway wake and status.      |
| `MARITIME_API_URL`                           | no     | Reviewed Maritime API base URL.                                    |
| `VERA_CREDENTIAL_KEY_ID`                     | no     | Active application-layer encryption key identifier.                |
| `VERA_CREDENTIAL_KEYS_JSON`                  | yes    | Versioned application-layer credential keyring.                    |
| `VERA_GOOGLE_INTEGRATION_CLIENT_ID`          | no     | Google integration Web Application client identifier.              |
| `VERA_GOOGLE_INTEGRATION_CLIENT_SECRET`      | yes    | Google integration client secret.                                  |
| `VERA_GMAIL_ALERTS_DISABLED`                 | no     | Gmail ingestion kill switch; missing or `1` denies execution.      |
| `VERA_INTEGRATIONS_DISABLED`                 | no     | Global integration kill switch.                                    |
| `OPENCLAW_GATEWAY_URL`                       | no     | Browser-experimental TLS endpoint; forbidden for founder core.     |
| `OPENCLAW_GATEWAY_TOKEN`                     | yes    | Browser-experimental token; forbidden for founder core.            |
| `VERA_OPENCLAW_EXECUTABLE`                   | no     | Absolute lockfile-installed CLI path in hosted workers.            |
| `VERA_BROWSER_FOUNDER_USER_IDS`              | no     | Browser-experimental allowlist; forbidden for founder core.        |
| `VERA_BROWSER_DISABLED`                      | no     | Global browser kill switch; disabled is the default release state. |
| `VERA_BROWSER_BETA_USER_IDS`                 | no     | Up to 25 exact Vera UUIDs eligible for assignment resolution.      |
| `VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED`    | no     | Assignment routing gate; missing or non-`1` denies browser work.   |
| `VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION` | no     | Must be exactly `sha256.v1`; anything else denies resolution.      |
| `NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY`          | no     | Public Web Push application key.                                   |
| `VERA_VAPID_PRIVATE_KEY`                     | yes    | Web Push signing key.                                              |
| `VERA_VAPID_SUBJECT`                         | no     | VAPID operator contact URI.                                        |
| `VERA_NOTIFICATIONS_DISABLED`                | no     | Notification kill switch; must be explicitly cleared.              |
| `OPENAI_API_KEY`                             | yes    | Optional structured-extraction provider key.                       |
| `VERA_LLM_MODEL`                             | no     | Explicit provider model selection.                                 |
| `PORT`                                       | no     | Maritime-injected HTTP port; Vera defaults to 8080.                |

## Dedicated per-user Browser Connector assignment

These values must not reuse the RentCast live-search agent or its credential. Repeat this isolated
set per Vera user; do not share one Gateway across unrelated renters.

| Name                                                | Secret | Purpose                                                        |
| --------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `OPENCLAW_HEADLESS`                                 | no     | Enables official headless Gateway mode.                        |
| `OPENCLAW_CONFIG_PATH`                              | no     | Exact reviewed remote-extension configuration path.            |
| `OPENCLAW_GATEWAY_TOKEN`                            | yes    | Protects non-extension Gateway authentication surfaces.        |
| `OPENCLAW_EXTENSION_PAIRING_SEED`                   | yes    | Optional managed-runtime bootstrap seed; private and per-user. |
| `VERA_BROWSER_RESEARCH_CHECKPOINT_URL`              | no     | Exact assigned Vera checkpoint endpoint.                       |
| `VERA_BROWSER_RESEARCH_CHECKPOINT_TOKEN`            | yes    | Raw per-assignment checkpoint value; sidecar only.             |
| `VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED`            | no     | Explicit connectivity-spike flag; missing or non-`1` denies.   |
| `VERA_REMOTE_EXTENSION_SNAPSHOT_TIMEOUT_MS`         | no     | Bounded hosted Vera request timeout.                           |
| `VERA_REMOTE_EXTENSION_SNAPSHOT_MAX_RESPONSE_BYTES` | no     | Bounded hosted Vera response size.                             |

The Vera web secret store uses
`VERA_BROWSER_ASSIGNMENT_<REFERENCE>_MARITIME_API_KEY` and
`VERA_BROWSER_ASSIGNMENT_<REFERENCE>_PLAN_SIGNING_KEY`. The database stores only the reference and
credential digests. Never configure the legacy global browser-Gateway key, agent, founder, token,
or local-bridge selectors in an assignment-routed release.

The dedicated Gateway uses its pinned model only to invoke Vera's fixed allowlisted bounded tools;
the model does not decide source policy, field truth, deduplication, fit scoring, or external
actions. Do not configure channels, messaging, web search/fetch, exec, filesystem, unrestricted
node/browser tools, or unrelated provider credentials. Control UI and model HTTP endpoints remain
disabled.

The live proxy probe reads `OPENCLAW_EXTENSION_GATEWAY_URL`,
`OPENCLAW_EXTENSION_PAIRING_SECRET`, and `VERA_REMOTE_EXTENSION_PROXY_SMOKE` only from a restricted
operator environment. Those probe values are not web application variables and never use a
`NEXT_PUBLIC_` prefix.

Marketplace passwords, cookies, storage state, profile directories, raw snapshots, OAuth refresh tokens, and Gmail message content are prohibited Maritime environment values.

## Rollback-only legacy names

`VERA_BROWSER_GATEWAY_FOUNDER_USER_ID`, `MARITIME_BROWSER_GATEWAY_API_KEY`,
`MARITIME_BROWSER_GATEWAY_AGENT_ID`, `VERA_BROWSER_RESEARCH_PLAN_SIGNING_KEY`, and the global
local-bridge selectors exist only for an exact pre-assignment application rollback while the
browser kill switch remains on. Never restore an old relay, pairing, or checkpoint credential.

## Operator credentials

The CLI reads `MARITIME_TOKEN` only from the operator's local protected environment. Use a separate deploy-scoped key for CI/operator deployment and a narrower runtime `MARITIME_API_KEY` for Vera. Revoke either independently. Do not reuse the web application's Google or session secrets as Maritime credentials.
