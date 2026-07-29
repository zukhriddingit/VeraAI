# DigitalOcean Asynchronous Resource Reconciliation Design

**Status:** Approved for implementation on 2026-07-29

## Goal

Separate DigitalOcean resource-creation acknowledgement from final resource verification so a
successful asynchronous certificate or Load Balancer create cannot be misclassified, orphaned, or
duplicated. Apply the same durable state model to every disposable Milestone 13A resource without
changing the Gateway image, OpenClaw, the Droplet bootstrap, product behavior, or Milestone 13B.

## Confirmed failure

The second corrected live run reached authoritative DNS delegation and DigitalOcean created a
managed certificate that became `verified`. The live script required HTTP `201` before persisting
the returned certificate identity. The response did not satisfy that narrow contract, so the
script raised `certificate_creation_failed` even though exact-name readback found one verified
certificate. Cleanup recovered and deleted it; no Load Balancer was created.

## Approaches

### Selected: atomic run journal plus typed resource state machines

One mode-`0600` journal in a mode-`0700` private run directory records each provider identity
immediately after it becomes knowable. Certificate and Load Balancer state machines classify the
HTTP acknowledgement, reconcile ambiguous responses by exact run-specific name, validate identity
by persisted ID, poll bounded final state, and clean up independently after restart.

This is the only approach that satisfies response ambiguity, process interruption, idempotency,
cross-run isolation, and complete cleanup together.

### Rejected: accept another certificate status code

Allowing a second hard-coded status would fix the observed case but would still lose the resource
identity on an interrupted response, create duplicates on rerun, and leave Load Balancer creation
with the same weakness.

### Rejected: provider SDK or Terraform state

Adding an SDK or Terraform would introduce dependencies and a second state system for one
founder-only disposable path. The existing dependency-free TypeScript API boundary is sufficient
once it records response observations and durable resource state correctly.

## Components

### Resource journal

`resource-journal.ts` owns a closed versioned schema. Each entry contains:

- resource kind: DNS zone, certificate, Droplet, firewall, tag, SSH key, Load Balancer, or DNS
  record;
- exact unique run-specific name;
- provider ID as a string;
- current provider status;
- creation timestamp;
- cleanup state: `active`, `delete_pending`, `deleted`, or `delete_failed`.

The journal contains no API token, authorization header, private key, Gateway token, pairing seed,
or arbitrary provider payload. Writes use a same-directory exclusive temporary file, file `fsync`,
atomic rename, and directory `fsync`. Opening an existing journal validates the exact schema and
mode, enabling restart and reconciliation.

Every mutation path records a returned resource identity before validation, polling, or the next
provider mutation. The existing diagnostics stack records tag, firewall, SSH key, and Droplet in
that order. Cleanup updates each entry before and after deletion and is independently callable.

### Observed provider responses

`digitalocean-api.ts` adds a bounded response-observation boundary:

- numeric HTTP status;
- allowlisted response headers only;
- optional provider request ID;
- bounded body length/truncation metadata;
- parsed JSON when valid.

Authorization headers and token values never enter the observation or an error. Explicit
authentication, authorization, validation, and rate-limit failures remain typed failures.
Transport errors remain distinguishable so the caller can reconcile before deciding whether a
server-side creation occurred.

### Managed certificate state machine

The certificate state machine:

1. resumes a journaled ID when present;
2. otherwise reconciles one exact-name certificate within the run window before creating;
3. sends one create request only when reconciliation returns zero matches;
4. classifies `201` as documented acknowledgement and any other 2xx as nonstandard
   acknowledgement;
5. persists any returned ID immediately;
6. if no ID is returned, requires exactly one exact-name/type/DNS-set/run-window match;
7. reads the certificate by the persisted ID and validates exact identity;
8. polls `pending` to `verified` for at most ten minutes with bounded jitter;
9. fails closed on `error`, disappearance, identity mismatch, multiple matches, or timeout.

Cleanup deletes only the persisted identity or one exact reconciled run-specific match and verifies
absence.

### Managed Load Balancer state machine

The Load Balancer state machine applies the same acknowledgement, persistence, reconciliation,
restart, and cleanup rules. Readback additionally validates the exact name, region, single Droplet,
certificate ID, HTTPS `443` to HTTP `18789` forwarding rule, TCP health check, no port `80`, no
redirect, no PROXY protocol, and no unrelated forwarding rule. An acknowledged create is not ready
until the exact resource has a public address and active provider state.

The DNS A record remains forbidden until that complete readback succeeds.

## Error and cleanup behavior

All thrown errors use bounded typed codes. Provider bodies, request IDs, resource IDs, names,
addresses, and credentials are private evidence, not error text. Ambiguous transport delivery
always performs exact-name reconciliation. Zero or multiple exact matches fails closed.

Cleanup never performs fuzzy or prefix matching. It deletes only journaled IDs or one exact
run-specific identity that also passes type/configuration/run-window checks. A resource from
another run is never adopted or deleted.

## Test strategy

Table-driven Vitest coverage exercises documented and nonstandard certificate acknowledgements,
ID/no-ID responses, parse failures, explicit provider errors, ambiguous transport delivery,
pending/verified/error/timeout states, persistence-before-polling, interruption/restart, exact-name
cleanup, and cross-run rejection.

Equivalent Load Balancer coverage exercises asynchronous acknowledgement, immediate persistence,
delayed readiness, reconciliation, identity mismatch, duplicate matches, restart, and partial
cleanup. Journal tests prove schema closure, atomic replacement, mode enforcement, secret
rejection, and cleanup isolation.

Static verification and CI require the journal and both state machines, while preserving the exact
Gateway digest and all existing bootstrap/network gates.

## Live sequence

After the focused PR passes CI and is merged, one certificate-only preflight creates only the
temporary delegated child zone and one certificate through the repaired state machine. A Droplet is
created only if that preflight records the actual HTTP status, journals the certificate ID, verifies
the exact certificate, reaches `verified`, rejects duplicates, and proves independent cleanup
discovery.

The full disposable run then follows the already approved backend, managed Load Balancer, public
WSS, one-tab Chrome snapshot, revocation, evidence, and cleanup gates. Any failure removes every
disposable provider and local resource. Only complete success returns `passed_13a`.

## Non-goals

- No Gateway rebuild or mutable tag.
- No OpenClaw or cloud-init architecture change.
- No alternate cloud provider.
- No landing-page, apex DNS, Vercel, or product-code change.
- No rental-source browsing or adapter implementation.
- No Milestone 13B authorization.
