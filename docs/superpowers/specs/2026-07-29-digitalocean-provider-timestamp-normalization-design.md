# DigitalOcean Provider Timestamp Normalization Design

## Context

The final Milestone 13A certificate-only preflight received HTTP `202` from DigitalOcean and the
managed Let's Encrypt certificate reached `verified`. DigitalOcean returned the certificate
`created_at` value as `2026-07-29T23:38:23Z`. The durable resource journal accepts only canonical
UTC instants produced by `Date.prototype.toISOString()`, so it correctly rejected that unnormalized
provider value before persisting the certificate ID.

No Droplet, firewall, SSH key, tag, Load Balancer, public WSS endpoint, or Chrome pairing was
created. The exact certificate, delegated child zone, DNS records, token, and local credential were
removed.

## Goal

Normalize valid DigitalOcean RFC3339 resource timestamps to canonical UTC millisecond form at the
provider-consumption boundary before certificate or Load Balancer identities enter the resource
journal.

For example:

```text
2026-07-29T23:38:23Z
  -> 2026-07-29T23:38:23.000Z
```

The repair must cover both provider readback objects and identities parsed from asynchronous create
acknowledgements.

## Non-goals

- Do not weaken the resource journal's canonical-instant invariant.
- Do not change the immutable Gateway image, source revision, UID/GID, bootstrap, routes, pairing,
  Origin restrictions, or browser tools.
- Do not change DigitalOcean resource topology, scopes, cleanup order, or timeouts.
- Do not create live infrastructure during this code repair.
- Do not modify the landing page or begin Milestone 13B.

## Considered approaches

### 1. Normalize at every DigitalOcean provider-consumption path

Add one strict RFC3339 normalization helper to the DigitalOcean API boundary and reuse it from:

- certificate readback parsing;
- Load Balancer readback parsing;
- certificate create-acknowledgement identity parsing; and
- Load Balancer create-acknowledgement identity parsing.

This keeps the journal strict, covers both asynchronous response and later readback paths, and
centralizes the provider-format contract.

### 2. Relax the journal validator

Allow any parseable timestamp in the resource journal. This is a smaller edit but weakens the
durable state invariant for every resource and permits equivalent timestamps to have different
serialized identities.

### 3. Normalize independently in each managed-resource state machine

Canonicalize timestamps separately in the certificate and Load Balancer modules. This preserves
the journal invariant but duplicates provider parsing and leaves API readback objects
unnormalized.

## Decision

Use approach 1.

## Timestamp contract

Create an exported DigitalOcean boundary helper with this behavior:

```ts
normalizeDigitalOceanInstant(value: unknown, errorCode: string): string
```

The helper must:

1. require a string in RFC3339 date-time form;
2. accept whole-second and fractional-second precision;
3. accept `Z` or a numeric timezone offset;
4. reject invalid calendar values, missing timezone information, whitespace, and non-date strings;
5. return `new Date(timestamp).toISOString()`; and
6. throw only the caller-provided typed response error code.

Examples:

```text
2026-07-29T23:38:23Z       -> 2026-07-29T23:38:23.000Z
2026-07-29T23:38:23.125Z   -> 2026-07-29T23:38:23.125Z
2026-07-29T19:38:23-04:00  -> 2026-07-29T23:38:23.000Z
2026-07-29 23:38:23        -> rejected
not-a-date                 -> rejected
```

## Data flow

### Readback

```text
DigitalOcean JSON created_at
  -> resource-specific response parser
  -> normalizeDigitalOceanInstant
  -> DigitalOceanCertificate or DigitalOceanLoadBalancer.createdAtUtc
  -> identity validation
  -> resource journal
```

### Create acknowledgement

```text
bounded DigitalOcean create observation
  -> resource-specific returnedIdentity parser
  -> normalizeDigitalOceanInstant when created_at is present
  -> immediate journal persistence
  -> exact readback and readiness polling
```

If `created_at` is absent from an otherwise identifiable create acknowledgement, the existing
bounded local `now().toISOString()` fallback remains unchanged. If `created_at` is present but
invalid, the response is rejected rather than silently replaced with local time.

## Error handling

- Certificate timestamp failures use `certificate_response_rejected`.
- Load Balancer timestamp failures use `load_balancer_response_rejected`.
- Missing `created_at` remains distinct from malformed `created_at`.
- No provider body, credential, authorization header, or resource ID is added to error messages.
- Cleanup and exact-name reconciliation behavior remains unchanged.

## Testing

Add table-driven unit coverage for the normalization helper:

- whole-second UTC;
- fractional-second UTC;
- numeric timezone offset;
- invalid calendar value;
- missing timezone;
- surrounding whitespace;
- non-string input.

Add API boundary regression tests proving certificate and Load Balancer readback convert the exact
whole-second provider shape to canonical `.000Z`.

Add certificate and Load Balancer state-machine regression tests proving an asynchronous create
acknowledgement with whole-second `created_at`:

1. returns the documented or nonstandard acknowledgement classification;
2. persists the canonical timestamp and exact ID before polling;
3. resumes from the journal without creating a duplicate; and
4. reaches the existing verified/active terminal state.

Run the focused DigitalOcean unit suite, infrastructure validator, formatting, lint, typecheck,
full unit suite, and secret/diff review.

## Acceptance

The repair is complete when:

- the real provider timestamp shape `2026-07-29T23:38:23Z` is accepted and stored as
  `2026-07-29T23:38:23.000Z`;
- malformed provider timestamps fail closed;
- certificate and Load Balancer create/readback paths share the same normalization contract;
- the journal remains strict and unchanged;
- all required validation passes; and
- no live infrastructure or product behavior changes.
