# DigitalOcean founder browser Gateway

This directory contains the reproducible, diagnostics-first DigitalOcean deployment boundary for
Milestone 13A. It deploys exactly one hardened OpenClaw Gateway container on one Ubuntu Droplet.
The Droplet is never the public TLS edge.

```text
official OpenClaw Chrome extension
  -> HTTPS/WSS :443
  -> DigitalOcean managed Regional Load Balancer
  -> VPC HTTP :18789
  -> one immutable Vera OpenClaw Gateway
  -> exactly one explicitly shared tab
```

The first failed Droplet is historical evidence only. Its primary cause was
`cloud_init_command_failure`: Lego 5.2.1 rejected the incorrectly positioned `--email` flag before
Docker created either the Gateway or edge container. This design contains no Lego or custom edge.

## Immutable inputs

Gateway image:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd
```

Source revision:

```text
f155bca09d57017ac141d2c8f3eebd26657aeb3d
```

Do not substitute a tag, rebuild the image, add an edge container, or change UID/GID `1000:1000`.

## Local validation

From the repository root:

```sh
pnpm verify:digitalocean-browser-gateway
bash infra/digitalocean/browser-gateway/validate.sh
pnpm exec vitest run --project unit \
  infra/digitalocean/browser-gateway/config.unit.test.ts \
  infra/digitalocean/browser-gateway/digitalocean-api.unit.test.ts \
  infra/digitalocean/browser-gateway/lifecycle.unit.test.ts \
  scripts/verify-digitalocean-browser-gateway.unit.test.ts
```

CI additionally sets `VERA_DO_VALIDATE_WITH_DOCKER=1` so a pinned Ubuntu container runs the official
`cloud-init schema` check.

## Private operator inputs

Use a temporary DigitalOcean token with only the read/create/update/delete scopes required for:

- Droplets, regions, sizes, images, actions, VPCs, tags, firewalls, and SSH keys;
- Regional Load Balancers;
- certificates; and
- the founder-controlled domain and its records.

DigitalOcean requires the corresponding read scope for each mutation scope. Create the token in
Apps & API, copy it directly into macOS Keychain, and never paste it into chat, a shell history,
Git, or an evidence record. Delete the token at final cleanup.

Create a mode-`0700` private run directory beneath `release-evidence/private/`. Store these inputs
as separate mode-`0600` files:

- one fresh 32-byte lowercase-hex Gateway token;
- one distinct fresh 32-byte lowercase-hex extension pairing seed;
- one new Ed25519 private key;
- its public key; and
- the rendered cloud-config.

The renderer rejects symlinks, group/world-readable files, malformed credentials, reused
credentials, unresolved markers, an unsafe output directory, and an existing output:

```sh
pnpm tsx infra/digitalocean/browser-gateway/render-cloud-init.ts \
  --template infra/digitalocean/browser-gateway/cloud-init.template.yaml \
  --gateway-token-file release-evidence/private/<run>/gateway-token \
  --pairing-seed-file release-evidence/private/<run>/pairing-seed \
  --output release-evidence/private/<run>/cloud-init.rendered.yaml
```

The command prints only `rendered_cloud_init=ready`.

## Diagnostics-first creation

Resolve this Mac's current public IPv4 through a reviewed operator check. Pass the bare IPv4 to the
create tool; it adds `/32` itself. Never supply `0.0.0.0/0`, IPv6, a CIDR, or a guessed address.

Expose the temporary token to only the child process as `VERA_DO_API_TOKEN`. The tool requires the
literal confirmation `create-one-disposable-gateway`:

```sh
pnpm tsx infra/digitalocean/browser-gateway/create-diagnostics-stack.ts \
  --confirm create-one-disposable-gateway \
  --suffix <UTC-YYYYMMDD-sequence> \
  --operator-ipv4 <exact-current-public-ipv4> \
  --ssh-public-key release-evidence/private/<run>/id_ed25519.pub \
  --cloud-init release-evidence/private/<run>/cloud-init.rendered.yaml \
  --manifest release-evidence/private/<run>/stack.private.json
```

The create order is tag, tag-attached Cloud Firewall, temporary SSH key, then Droplet. The only
initial inbound rule is TCP 22 from the exact operator IPv4 `/32`. Ports 80, 443, and 18789 have no
public rule. The DigitalOcean Droplet Agent remains enabled for the Recovery Console. No Load
Balancer, DNS record, certificate, or public Gateway route exists at this stage.

The private manifest includes live IDs and addresses and must never be committed or pasted into
chat.

## Bootstrap monitoring

Use key-only SSH from the exact authorized Mac. Password authentication and keyboard-interactive
authentication are disabled. Bound every wait:

```sh
ssh -i release-evidence/private/<run>/id_ed25519 \
  -o IdentitiesOnly=yes \
  -o PasswordAuthentication=no \
  -o KbdInteractiveAuthentication=no \
  root@<private-manifest-public-ip>
```

On the Droplet, wait at most ten minutes for `cloud-init status --wait`, then inspect only:

- `cloud-init status --long`;
- `systemctl status vera-browser-gateway-bootstrap.service`;
- failed units and Docker state;
- the exact image/container identity;
- state and credential file ownership/modes;
- environment variable names only;
- `ss -lntup`;
- the sanitized provisioning result;
- bounded, redacted Gateway logs; and
- shallow/deep security-audit summaries.

If bootstrap fails, record the first failed stage, collect sanitized evidence, create no public
resource, and run cleanup immediately.

The internal listener gate is intentionally polled for up to 90 seconds. A disposable Droplet
diagnostic observed the route filter on `18789` before OpenClaw `18790` and browser control `18792`;
an immediate assertion at that boundary is a startup-ordering race and must remain a regression
failure.

## Required backend-local acceptance

Before any public ingress, backend-local acceptance must prove all of the following:

1. Docker is active and exactly one container runs the reviewed digest.
2. Runtime UID/GID is `1000:1000`; the reviewed PATH/allowlist remains intact.
3. No shell or package manager exists in the Gateway image.
4. Persistent state is owned by `1000:1000` with mode `0700`; credential inputs are mode `0600`.
5. Route filter 18789, OpenClaw 18790, and browser control 18792 listen; no unexpected listener
   exists.
6. An unrelated route returns 404 and ordinary `/browser/extension` HTTP returns only the bounded
   non-upgrade response.
7. A wrong relay secret returns 401.
8. The correct local WebSocket request returns 101 and selects `openclaw-extension-relay`.
9. Ping/pong, bounded stability, bounded payload, and oversized-payload failure pass.
10. Shallow and deep OpenClaw security audits have zero critical and zero warnings.
11. No secret appears in logs.

Do not continue if any check fails.

## Remove operator ingress

After the backend passes, remove the temporary SSH rule by updating the Cloud Firewall to zero
inbound rules. Then remove the temporary SSH key from `/root/.ssh/authorized_keys`, close the
session, and delete the temporary key from the DigitalOcean account. Verify external SSH is
unreachable. The Recovery Console is the only emergency path.

The Droplet must have no direct inbound rule for 22, 80, 443, or 18789. Do not recreate the SSH
rule.

## DNS, certificate, and Regional Load Balancer

Use a dedicated temporary hostname under a founder-controlled domain managed through DigitalOcean
DNS. Do not modify the marketing landing-page deployment. If no controlled DigitalOcean DNS zone
or delegated subdomain is available, pause rather than using a self-signed certificate.

Create a DigitalOcean-managed Let's Encrypt certificate and exactly one Regional Load Balancer only
after every backend-local gate passes:

- entry protocol HTTPS, entry port 443;
- target protocol HTTP, target port 18789;
- exactly one backend Droplet in `nyc1`;
- a TCP 18789 health check;
- no entry port 80, redirect, PROXY protocol, or sticky session;
- documented HTTP/WebSocket idle timeout; and
- the valid managed certificate.

Update the Droplet Cloud Firewall to allow TCP 18789 only from the exact Load Balancer UID. Never
allow 18789 from an address or public CIDR. Wait until the backend is healthy.

## Public WSS acceptance

Against the exact temporary hostname, prove certificate trust, route isolation, Control UI absence,
bounded ordinary HTTP behavior, wrong-secret 401, correct 101, `openclaw-extension-relay`
selection, `Sec-WebSocket-Protocol` preservation, valid `chrome-extension://` Origin acceptance,
invalid-Origin denial, ping/pong, stability, payload bounds, oversized-payload rejection, and
secret-free logs.

Stop before Chrome if any gate fails.

## Manual Chrome checkpoint

Place the official pairing string on the macOS clipboard without printing it. Ask the founder to:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load the reviewed official extension directory unpacked.
4. Pin and open the extension.
5. Paste the pairing string and complete pairing.
6. Open exactly `https://example.com/`.
7. Share exactly that one tab.
8. Reply: `Paired and one example.com tab shared.`

After confirmation, execute one minimized read-only snapshot. Do not navigate, click, type, access
a form, upload, download, retain a screenshot, or access cookies, storage, history, passwords, or
another tab. Retain no raw page content.

Ask the founder to unshare. Verify shared-tab count zero, verify the next snapshot fails with
`no_shared_tab`, then revoke pairing.

## Failure and cleanup

Any failed gate returns `founder_browser_experimental=no_go`. Run:

```sh
pnpm tsx infra/digitalocean/browser-gateway/cleanup-stack.ts \
  --manifest release-evidence/private/<run>/stack.private.json
```

Cleanup order is Load Balancer, DNS record, certificate, Droplet, firewall, SSH key, and tag.
Missing resources are idempotent success. Also delete the temporary API token, local key/credential
files, and Keychain entries. Preserve only sanitized private evidence and verify zero billable
disposable resources.

On success, revoke browser access and keep every tab unshared while asking whether to retain the
working Gateway temporarily for founder recording or destroy it immediately. Do not silently leave
it running.

Only a validated `passed_13a` result authorizes Milestone 13B. This runbook does not itself authorize
Milestone 13B, rental-site access, source adapters, browser interaction, or landing-page changes.
