# Maritime environment manifest

Values live in environment-specific secret stores, never in Git. Development, staging, and production use separate credentials. The web application retains its own hosted secret configuration; this table covers Maritime services.

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
| `VERA_MARITIME_GATEWAY_AGENT_ID`        | no     | Exact founder gateway deployment identifier.                       |
| `VERA_MARITIME_ENVIRONMENT`             | no     | `development`, `staging`, or `production`.                         |
| `MARITIME_API_KEY`                      | yes    | Narrow server runtime key for worker/gateway wake and status.      |
| `MARITIME_API_URL`                      | no     | Reviewed Maritime API base URL.                                    |
| `VERA_CREDENTIAL_KEY_ID`                | no     | Active application-layer encryption key identifier.                |
| `VERA_CREDENTIAL_KEYS_JSON`             | yes    | Versioned application-layer credential keyring.                    |
| `VERA_GOOGLE_INTEGRATION_CLIENT_ID`     | no     | Google integration Web Application client identifier.              |
| `VERA_GOOGLE_INTEGRATION_CLIENT_SECRET` | yes    | Google integration client secret.                                  |
| `VERA_GMAIL_ALERTS_DISABLED`            | no     | Gmail ingestion kill switch; missing or `1` denies execution.      |
| `VERA_INTEGRATIONS_DISABLED`            | no     | Global integration kill switch.                                    |
| `OPENCLAW_GATEWAY_URL`                  | no     | Exact TLS `wss` endpoint for the pinned gateway.                   |
| `OPENCLAW_GATEWAY_TOKEN`                | yes    | Gateway authentication token, server-side only.                    |
| `VERA_OPENCLAW_EXECUTABLE`              | no     | Absolute lockfile-installed CLI path in hosted workers.            |
| `VERA_BROWSER_FOUNDER_USER_IDS`         | no     | Exact founder UUID allowlist; missing or malformed denies.         |
| `VERA_BROWSER_DISABLED`                 | no     | Global browser kill switch; disabled is the default release state. |
| `NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY`     | no     | Public Web Push application key.                                   |
| `VERA_VAPID_PRIVATE_KEY`                | yes    | Web Push signing key.                                              |
| `VERA_VAPID_SUBJECT`                    | no     | VAPID operator contact URI.                                        |
| `VERA_NOTIFICATIONS_DISABLED`           | no     | Notification kill switch; must be explicitly cleared.              |
| `OPENAI_API_KEY`                        | yes    | Optional structured-extraction provider key.                       |
| `VERA_LLM_MODEL`                        | no     | Explicit provider model selection.                                 |
| `PORT`                                  | no     | Maritime-injected HTTP port; Vera defaults to 8080.                |

## OpenClaw gateway

| Name                     | Secret | Purpose                                                            |
| ------------------------ | ------ | ------------------------------------------------------------------ |
| `OPENCLAW_HEADLESS`      | no     | Enables the official headless gateway mode.                        |
| `OPENCLAW_CONFIG_PATH`   | no     | Exact reviewed `/data/.openclaw/openclaw.json` configuration path. |
| `OPENCLAW_GATEWAY_TOKEN` | yes    | Authenticates worker and explicitly paired node connections.       |
| `VERA_OPENCLAW_NODE_ID`  | no     | Exact founder node selected by manual browser routing.             |

Do not set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, channel credentials, messaging credentials, or
other model/provider secrets on the OpenClaw gateway. Vera uses it only as an authenticated
gateway/node-browser proxy, not as an autonomous agent.

Marketplace passwords, cookies, storage state, profile directories, raw snapshots, OAuth refresh tokens, and Gmail message content are prohibited Maritime environment values.

## Operator credentials

The CLI reads `MARITIME_TOKEN` only from the operator's local protected environment. Use a separate deploy-scoped key for CI/operator deployment and a narrower runtime `MARITIME_API_KEY` for Vera. Revoke either independently. Do not reuse the web application's Google or session secrets as Maritime credentials.
