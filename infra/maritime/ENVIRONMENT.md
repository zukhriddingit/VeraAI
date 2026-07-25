# Maritime environment manifest

Values live in environment-specific secret stores, never in Git. Development, staging, and production use separate credentials. The web application retains its own hosted secret configuration; this table covers Maritime services.

For `founder_core`, set `VERA_BROWSER_DISABLED=1` and do not define any remote-extension or legacy
browser-Gateway variable. The worker agent ID and scoped API key form the complete Maritime
control-plane tuple for core. Remote-extension variables below apply only to
`founder_browser_experimental`, which remains `no_go`.

## Vera worker

| Name                                    | Secret | Purpose                                                            |
| --------------------------------------- | ------ | ------------------------------------------------------------------ |
| `DATABASE_URL`                          | yes    | Canonical managed PostgreSQL connection.                           |
| `VERA_DB_POOL_MAX`                      | no     | Bounded founder worker pool size.                                  |
| `VERA_DB_CONNECTION_TIMEOUT_MS`         | no     | Connection timeout.                                                |
| `VERA_DB_STATEMENT_TIMEOUT_MS`          | no     | Statement timeout.                                                 |
| `VERA_DB_LOCK_TIMEOUT_MS`               | no     | Lock timeout.                                                      |
| `VERA_DB_IDLE_TRANSACTION_TIMEOUT_MS`   | no     | Idle transaction timeout.                                          |
| `VERA_MARITIME_WORKER_AGENT_ID`         | no     | Exact worker audience and deployment identifier.                   |
| `VERA_MARITIME_GATEWAY_AGENT_ID`        | no     | Browser-experimental gateway ID; forbidden for founder core.       |
| `VERA_MARITIME_ENVIRONMENT`             | no     | `development`, `staging`, or `production`.                         |
| `MARITIME_API_KEY`                      | yes    | Narrow server runtime key for worker/gateway wake and status.      |
| `MARITIME_API_URL`                      | no     | Reviewed Maritime API base URL.                                    |
| `VERA_CREDENTIAL_KEY_ID`                | no     | Active application-layer encryption key identifier.                |
| `VERA_CREDENTIAL_KEYS_JSON`             | yes    | Versioned application-layer credential keyring.                    |
| `VERA_GOOGLE_INTEGRATION_CLIENT_ID`     | no     | Google integration Web Application client identifier.              |
| `VERA_GOOGLE_INTEGRATION_CLIENT_SECRET` | yes    | Google integration client secret.                                  |
| `VERA_GMAIL_ALERTS_DISABLED`            | no     | Gmail ingestion kill switch; missing or `1` denies execution.      |
| `VERA_INTEGRATIONS_DISABLED`            | no     | Global integration kill switch.                                    |
| `OPENCLAW_GATEWAY_URL`                  | no     | Browser-experimental TLS endpoint; forbidden for founder core.     |
| `OPENCLAW_GATEWAY_TOKEN`                | yes    | Browser-experimental token; forbidden for founder core.            |
| `VERA_OPENCLAW_EXECUTABLE`              | no     | Absolute lockfile-installed CLI path in hosted workers.            |
| `VERA_BROWSER_FOUNDER_USER_IDS`         | no     | Browser-experimental allowlist; forbidden for founder core.        |
| `VERA_BROWSER_DISABLED`                 | no     | Global browser kill switch; disabled is the default release state. |
| `NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY`     | no     | Public Web Push application key.                                   |
| `VERA_VAPID_PRIVATE_KEY`                | yes    | Web Push signing key.                                              |
| `VERA_VAPID_SUBJECT`                    | no     | VAPID operator contact URI.                                        |
| `VERA_NOTIFICATIONS_DISABLED`           | no     | Notification kill switch; must be explicitly cleared.              |
| `OPENAI_API_KEY`                        | yes    | Optional structured-extraction provider key.                       |
| `VERA_LLM_MODEL`                        | no     | Explicit provider model selection.                                 |
| `PORT`                                  | no     | Maritime-injected HTTP port; Vera defaults to 8080.                |

## Dedicated per-user remote-extension Gateway

These values must not reuse the RentCast live-search agent or its credential. Repeat this isolated
set per Vera user; do not share one Gateway across unrelated renters.

| Name                                                | Secret | Purpose                                                         |
| --------------------------------------------------- | ------ | --------------------------------------------------------------- |
| `OPENCLAW_HEADLESS`                                 | no     | Enables official headless Gateway mode.                         |
| `OPENCLAW_CONFIG_PATH`                              | no     | Exact reviewed remote-extension configuration path.             |
| `OPENCLAW_GATEWAY_TOKEN`                            | yes    | Protects non-extension Gateway authentication surfaces.         |
| `OPENCLAW_EXTENSION_PAIRING_SECRET`                 | yes    | Pinned OpenClaw 2026.7.1 64-character lowercase hex secret.     |
| `MARITIME_BROWSER_GATEWAY_API_KEY`                  | yes    | Dedicated Vera server key for this user's browser Gateway only. |
| `MARITIME_BROWSER_GATEWAY_AGENT_ID`                 | no     | Dedicated browser Gateway agent ID for this user.               |
| `VERA_BROWSER_GATEWAY_FOUNDER_USER_ID`              | no     | Exact Vera founder UUID bound to this Gateway.                  |
| `VERA_REMOTE_EXTENSION_SNAPSHOT_ENABLED`            | no     | Explicit connectivity-spike flag; missing or non-`1` denies.    |
| `VERA_REMOTE_EXTENSION_SNAPSHOT_TIMEOUT_MS`         | no     | Bounded hosted Vera request timeout.                            |
| `VERA_REMOTE_EXTENSION_SNAPSHOT_MAX_RESPONSE_BYTES` | no     | Bounded hosted Vera response size.                              |

The dedicated Gateway requires a model only to invoke Vera's one allowlisted read-only snapshot
tool. Do not configure channels, messaging, web search/fetch, exec, filesystem, node, or unrelated
provider credentials. Control UI and model HTTP endpoints remain disabled.

The live proxy probe reads `OPENCLAW_EXTENSION_GATEWAY_URL`,
`OPENCLAW_EXTENSION_PAIRING_SECRET`, and `VERA_REMOTE_EXTENSION_PROXY_SMOKE` only from a restricted
operator environment. Those probe values are not web application variables and never use a
`NEXT_PUBLIC_` prefix.

Marketplace passwords, cookies, storage state, profile directories, raw snapshots, OAuth refresh tokens, and Gmail message content are prohibited Maritime environment values.

## Operator credentials

The CLI reads `MARITIME_TOKEN` only from the operator's local protected environment. Use a separate deploy-scoped key for CI/operator deployment and a narrower runtime `MARITIME_API_KEY` for Vera. Revoke either independently. Do not reuse the web application's Google or session secrets as Maritime credentials.
