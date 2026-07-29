# DigitalOcean Browser Gateway Acceptance Design

**Status:** Approved for implementation on 2026-07-29

## Goal

Make the founder-only remote Chrome-extension architecture reproducibly deployable and
acceptance-testable on one disposable DigitalOcean Droplet behind a DigitalOcean managed Regional
Load Balancer, without weakening the reviewed Gateway image or starting Milestone 13B.

The accepted topology is:

```text
official OpenClaw Chrome extension
  -> HTTPS/WSS :443
  -> DigitalOcean managed Regional Load Balancer
  -> private VPC HTTP :18789
  -> one hardened OpenClaw Gateway container
  -> exactly one explicitly shared Chrome tab
```

## Context

The first disposable Droplet failed safely. Cloud-init completed with a command failure because
Lego 5.2.1 received `--email` in the wrong CLI position. Docker was healthy, and neither the
Gateway nor the former Nginx edge container was created. The accepted correction removes Lego,
Nginx, public Droplet TLS, and direct public Gateway ingress. DigitalOcean terminates TLS only after
the private backend passes every local acceptance gate.

The reviewed Gateway remains immutable:

```text
ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:983f5fd5dd0d8c944f92d2988cf00cefb55750f58c5567a1ec8491c185b664fd
```

Its source revision is:

```text
f155bca09d57017ac141d2c8f3eebd26657aeb3d
```

## Approaches considered

### 1. Repository-owned TypeScript lifecycle tools plus a cloud-init template

This approach uses dependency-free Node/TypeScript helpers for DigitalOcean API requests, strict
input validation, private manifest handling, bounded polling, and idempotent cleanup. A shell
validator handles embedded Bash, cloud-init schema, and systemd-unit checks. It follows the
repository's existing TypeScript/Vitest conventions while keeping the guest bootstrap legible to
an operator.

This is the selected approach. It provides testable lifecycle behavior without introducing
Terraform state, a new package, or a provider SDK.

### 2. Pure shell with `curl` and `jq`

This would minimize source code, but JSON construction, rollback bookkeeping, typed response
validation, and unit testing would be substantially more fragile. It is retained only for small
guest-side validation fragments.

### 3. Terraform

Terraform would model the resources well, but it introduces state storage and provider-plugin
management for one disposable founder-only acceptance run. It also complicates secret-free
evidence and cleanup. It is rejected for this milestone.

## Repository components

The checked-in implementation lives under `infra/digitalocean/browser-gateway/`:

- `cloud-init.template.yaml` is placeholder-based and contains no live credential, IP, domain, or
  provider identifier. It installs Docker, writes a systemd oneshot bootstrap service, prepares a
  persistent state directory, starts exactly one immutable Gateway container, and records a
  sanitized local result.
- `infrastructure-intent.json` is the machine-reviewed provider contract: one Ubuntu 24.04
  `s-1vcpu-2gb` Droplet in `nyc1`, one tag-scoped firewall, one temporary key, bounded outbound
  rules, and no Load Balancer/DNS/TLS until local health succeeds.
- `render-cloud-init.ts` accepts two mode-`0600` secret input files, validates their formats and
  distinctness, renders the two exact placeholders once, writes a mode-`0600` output, and never
  prints a secret.
- `digitalocean-api.ts` is a narrow DigitalOcean API boundary with typed request/response
  validation, bounded polling, and sanitized errors.
- `create-diagnostics-stack.ts` creates the tag, firewall, temporary SSH key, and Droplet in that
  order. The firewall is attached to the unique tag before Droplet creation. It writes opaque
  resource identifiers and network addresses only to a private mode-`0600` manifest.
- `cleanup-stack.ts` consumes that private manifest and removes disposable resources in dependency
  order. Missing resources are idempotent success.
- `validate.sh` checks YAML/cloud-config structure, extracted shell syntax, systemd unit syntax when
  available, immutable image use, placeholder count, ingress prohibitions, cleanup traps, bounded
  timeouts, and failure visibility.
- `README.md` documents the two-person-safe operator sequence, secret handling, local acceptance,
  ingress removal, Load Balancer/DNS gates, failure teardown, and evidence boundaries.

`scripts/verify-digitalocean-browser-gateway.ts` and its Vitest suite enforce the static repository
contract. `package.json` and CI invoke both the TypeScript verifier and the shell validator.

## Guest bootstrap

Cloud-init writes five reviewed files (key-only SSH configuration, two mode-`0600` credential
inputs, the bootstrap, and its systemd unit), installs only `ca-certificates`, `curl`, `docker.io`,
and `jq`, then enables Docker and starts `vera-browser-gateway-bootstrap.service`.

The bootstrap:

1. validates the exact two 64-character lowercase-hex credentials from root-owned mode-`0600`
   files;
2. validates Docker is active;
3. resolves the Droplet's VPC IPv4 address from metadata with a bounded retry;
4. creates `/var/lib/vera-browser-gateway/state` as `1000:1000` mode `0700`;
5. pulls only the reviewed digest and verifies image UID/GID `1000:1000`;
6. removes only a prior container/network with the fixed Vera names;
7. creates one bridge network and one read-only, capability-free container with the persistent
   state mounted at `/data`;
8. publishes host port `18789` only on the VPC address;
9. waits for the exact 404/426 local HTTP contract and listeners 18789, 18790, and 18792;
10. runs shallow and deep OpenClaw security audits and requires zero critical and zero warnings;
11. verifies neither credential occurs in bounded container logs; and
12. records a sanitized `backend_ready` result.

Failure removes the container and private Docker network, writes a sanitized failed result, and
leaves no public endpoint. The persistent state is preserved for diagnostics. Re-running the
oneshot service safely recreates the fixed runtime from the same credential files and immutable
image.

## Provider lifecycle and networking

The operator supplies a temporary scoped DigitalOcean token through a private environment
boundary, never a command-line argument. The create tool requires an explicit confirmation value,
an exact operator IPv4 `/32`, a mode-`0600` rendered cloud-config, and a temporary SSH public key.

The initial Cloud Firewall has one inbound rule: TCP 22 from the exact operator `/32`. It has only
the outbound TCP, UDP, and ICMP traffic required for package installation, DNS, HTTPS, and registry
access. It exposes no inbound 80, 443, or 18789 rule.

After backend-local acceptance, the SSH rule and temporary `authorized_keys` entry are removed.
Only then may the operator create:

- one temporary hostname under a founder-controlled DigitalOcean-managed DNS zone;
- one DigitalOcean-managed Let's Encrypt certificate; and
- one Regional Load Balancer with HTTPS 443 to HTTP 18789.

The Droplet firewall then permits 18789 only from the exact Load Balancer resource. The Droplet
never directly exposes ports 22, 80, 443, or 18789 to the internet.

## Acceptance gates

Backend-local acceptance proves the exact digest, runtime identity, constrained executable surface,
persistent-state permissions, expected listeners, route isolation, correct/wrong pairing behavior,
subprotocol selection, ping/pong, bounded stability, payload limits, two security audits, and
secret-free logs.

Public acceptance proves the trusted certificate, exact hostname and route, denial of unrelated
HTTP/WebSocket routes, Control UI absence, pairing and Origin enforcement, subprotocol preservation,
ping/pong, stability, payload limits, and secret-free logs.

Manual Chrome acceptance uses the reviewed official extension and exactly one explicitly shared
`https://example.com/` tab. Vera performs one minimized read-only snapshot, retains no raw page
content or screenshot, performs no browser interaction, verifies `no_shared_tab` after unsharing,
and revokes pairing.

No Load Balancer is created before every backend-local gate passes. Chrome pairing does not start
if any public WSS gate fails.

## Evidence and failure behavior

Live resource identifiers, network addresses, credentials, hostname, and acceptance outputs remain
under `release-evidence/private/` with directories mode `0700` and files mode `0600`. Checked-in
files contain no real evidence.

Every failed bootstrap or acceptance immediately triggers dependency-ordered teardown of the Load
Balancer, DNS record, disposable certificate, Droplet, firewall, tag, temporary SSH key and API
token, local files, and Keychain entries. A failure returns
`founder_browser_experimental=no_go` with one primary failing layer and the smallest repair.

Success returns `passed_13a`, revokes browser access, leaves every tab unshared, and pauses for an
explicit founder choice between temporary recording retention and immediate destruction.
Milestone 13B is authorized only after the full successful evidence bundle validates.

## Non-goals

This work does not change the Gateway image, rebuild or republish it, deploy another cloud
provider, alter the landing page, access rental sites, add source adapters, enable browser
navigation or interaction, weaken founder-core gates, or begin Milestone 13B.
