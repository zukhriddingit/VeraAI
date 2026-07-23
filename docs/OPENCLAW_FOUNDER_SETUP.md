# OpenClaw founder setup — current-tab capture

Status: unsupported founder experiment · OpenClaw `2026.6.33` · Maritime gateway supported by operator runbook

Vera can capture one Zillow listing page that the authenticated founder has already opened in a dedicated local OpenClaw browser profile. Vera's adapter emits only `GET /tabs` and `GET /snapshot`; no Vera request can navigate, discover, paginate, click, type, evaluate arbitrary JavaScript, message, submit a form, apply, pay, change account settings, or bypass a blocker.

OpenClaw `2026.6.33` exposes those reads through the native `browser.proxy` node command. That native command has no path-level operation allowlist and can perform broader browser administration when called by another authorized client. The reviewed configuration reduces the node command set to `browser.proxy`, selects one profile, disables evaluation, and keeps this integration founder-only, but it does not make the native proxy itself read-only. Do not enable it for a broader beta until a narrow node-side capture command replaces this residual capability.

## Security and privacy boundary

- The marketplace login and browser profile stay on the founder-controlled node. Sign in manually; never give a Zillow password, 2FA code, cookie, storage export, profile archive, or password-manager value to Vera, OpenClaw automation, Maritime, an LLM, or Codex.
- The bounded listing snapshot required for capture traverses the configured OpenClaw gateway and reaches hosted Vera for ingestion. Do not describe this as local-only processing.
- PostgreSQL stores only bounded listing text/metadata, canonical URL, hashes, opaque node/profile/job identity, typed state, and redacted audit events. It does not store cookies, storage, the browser profile, CDP URLs, tab lists, screenshots, full snapshots beyond the accepted listing text, or gateway credentials.
- User authorization does not override Zillow's terms. The source remains disabled until the founder explicitly enables both user and Zillow controls.

## 1. Use the tested version

Install the node-host CLI outside Vera's web/worker dependency graph on the user-controlled
machine, then verify it from the Vera repository:

```bash
npm install --global openclaw@2026.6.33
pnpm openclaw:version
```

The output must contain `2026.6.33`. Any other version produces `version_incompatible`; do not upgrade in place before reviewing the node, browser-proxy, pairing, and security contract. The Maritime worker image carries the exact CLI for its server adapter; the local node installation remains outside Vera's repository and hosted persistence.

## 2. Configure the local browser profile

Create one dedicated profile and restrict the node proxy to it:

```bash
openclaw browser create-profile --name vera-zillow
openclaw browser start --browser-profile vera-zillow
```

Start from the fully reviewed node-host configuration at
`infra/maritime/openclaw/node.openclaw.json5`. Its relevant browser boundary is:

```json5
{
  browser: { enabled: true, evaluateEnabled: false },
  plugins: {
    enabled: true,
    bundledDiscovery: "allowlist",
    allow: ["browser"],
    load: { paths: [] },
    slots: { memory: "none" }
  },
  nodeHost: {
    browserProxy: {
      enabled: true,
      allowProfiles: ["vera-zillow"]
    }
  }
}
```

Run `pnpm verify:openclaw-config` after copying the reviewed configuration. The verifier checks it against the pinned CLI schema, confirms only the browser plugin loads on the node, and proves that the effective node-command allowlist resolves to exactly `browser.proxy` on every supported platform.

Open Zillow in that dedicated browser yourself and sign in manually if you choose. Leave the intended listing tab focused. Never reuse a daily browser profile that contains unrelated sensitive sessions.

## 3. Start a gateway and pair the node

For same-machine development, keep the gateway on loopback and provide its token only through the process environment or OpenClaw's secret-backed configuration:

```bash
openclaw gateway run
OPENCLAW_GATEWAY_TOKEN='<development-secret>' openclaw node run --host 127.0.0.1 --port 18789 --display-name "Vera founder browser"
```

Review and approve the exact requests using the current device/node flow:

```bash
openclaw devices list
openclaw devices approve <device-request-id>
openclaw nodes pending
openclaw nodes approve <node-request-id>
openclaw nodes status
```

Approve only the selected node and the browser-proxy capability. Do not grant Vera `system.run`, filesystem, unrelated profile, messaging, or broad browser capability. For a remote gateway, use `wss://` with a trusted certificate or a reviewed Tailscale/private-tunnel path; never expose raw CDP or a plaintext public WebSocket.

## 4. Configure hosted Vera

Set these as web/worker server secrets, never browser variables or committed files:

```text
OPENCLAW_GATEWAY_URL=wss://<existing-reviewed-maritime-gateway-endpoint>
OPENCLAW_GATEWAY_TOKEN=<secret>
VERA_OPENCLAW_EXECUTABLE=/workspace/apps/worker/node_modules/.bin/openclaw
VERA_BROWSER_DISABLED=0
```

Inventory and reconcile the existing Maritime/OpenClaw agent before setting these values. Do not create a second gateway merely because Vera's runbook contains deployment examples.

After `openclaw nodes status` confirms the exact node is connected and advertises `browser.proxy`, synchronize that verified non-secret identity into Vera. This command does not pair or approve OpenClaw; its acknowledgements record that the founder completed and reviewed those separate steps:

```bash
DATABASE_URL='postgresql://…' \
VERA_BROWSER_USER_ID='<authenticated-vera-user-uuid>' \
VERA_OPENCLAW_NODE_ID='<exact-openclaw-node-id>' \
VERA_OPENCLAW_NODE_NAME='Vera founder browser' \
VERA_OPENCLAW_PROFILE_ID='vera-zillow' \
VERA_OPENCLAW_PAIRING_VERIFIED='I_VERIFIED_DEVICE_AND_NODE_PAIRING' \
VERA_OPENCLAW_CAPABILITY_VERIFIED='I_VERIFIED_BROWSER_PROXY_ONLY' \
pnpm openclaw:register-node
```

Registration never transfers an OpenClaw token or profile path and leaves user/source controls disabled. Until registration and pairing evidence exist, the UI remains fail-closed. For production beyond founder dogfooding, replace this manual synchronization command with an authenticated, signed gateway-heartbeat adapter; do not treat it as a multi-user enrollment flow.

Then visit:

```text
Settings → Integrations → Local browser agent
```

Enable the founder experiment, confirm all four disclosures, paste the exact already-open Zillow listing URL, and choose **Capture current tab**. The worker checks the current tab URL before and after the fresh snapshot. A successful result enters raw ingestion, normalization, provenance, dedupe, ranking, risk, and audit; it never performs a site action.

## Blockers and recovery

| Visible state | Recovery |
| --- | --- |
| `deferred_node_offline` | Start the assigned node, wait for a fresh heartbeat, then explicitly retry. No empty result or cursor advance occurred. |
| Pairing/capability required | Review and approve the exact pending OpenClaw request; Vera never approves it for you. |
| Login, reauthentication, 2FA, CAPTCHA, consent, bot challenge | Resolve manually in the local profile, return to the exact listing, and retry. |
| Active URL mismatch or unexpected redirect | Focus the exact approved listing. Vera does not navigate back automatically. |
| Stale snapshot or changed layout | Reload/focus manually and retry only after inspection. No broad selector fallback runs. |
| Version incompatible | Restore OpenClaw `2026.6.33`; review before changing the pin. |

## Disable and remove

1. Disable the Zillow source or user browser control in Vera. `VERA_BROWSER_DISABLED=1` is the process-wide emergency kill switch.
2. Stop the node process.
3. Remove the paired node from OpenClaw with `openclaw nodes remove --node <id-or-name>`.
4. Delete the dedicated local profile through OpenClaw only after confirming you no longer need its local login state.
5. Rotate/revoke the gateway token and remove it from hosted secret management if the integration is retired or suspected compromised.

Vera retains accepted immutable listing evidence and redacted audit history according to product retention policy; disabling the connector does not rewrite historical provenance.

## Opt-in live smoke test

The default suite never invokes OpenClaw. With the dedicated tab focused and every value set explicitly:

```bash
VERA_OPENCLAW_LIVE_TEST=1 \
OPENCLAW_GATEWAY_URL='wss://<gateway>' \
OPENCLAW_GATEWAY_TOKEN='<secret>' \
VERA_OPENCLAW_NODE_ID='<node>' \
VERA_OPENCLAW_PROFILE_ID='vera-zillow' \
VERA_OPENCLAW_APPROVED_ZILLOW_URL='https://www.zillow.com/homedetails/.../123_zpid/' \
pnpm test:live:openclaw
```

The smoke test accepts either a bounded capture or a typed manual blocker. Partial configuration does not run the live test.
