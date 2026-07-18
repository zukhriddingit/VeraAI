# ADR 0004: Closed capabilities and fail-closed connectors

- Status: Accepted
- Date: 2026-07-17

## Context

Vera touches sources with different terms, authentication models, and side effects. A generic connector with broad verbs can accidentally turn a read path into navigation, scraping, messaging, or credential handling.

The plan's phrase “manual URL capture” also risks being implemented as an arbitrary server-side fetch, which would introduce platform scraping and SSRF exposure.

## Decision

Use a versioned connector registry and a closed, namespaced capability vocabulary. A request is allowed only when a valid, enabled manifest grants the exact connector, capability, operation, execution mode, target/domain, and approval state.

All missing, unknown, malformed, disabled, killed, expired, or exceptional states deny and append a reason-coded event.

Manual capture stores content supplied by the user. It may record a URL as inert provenance but performs no fetch, redirect, preview, script execution, or remote image download.

Fixture and manual capture are the first enabled ingestion paths. Gmail, structured feeds, and browser capture default to disabled. Browser capture is post-core, manual-only, and source-specific if later approved.

No send, apply, pay, upload, CAPTCHA, credential-login, arbitrary-fetch, or arbitrary-script capability exists in the MVP.

## Rationale

It is easier to prove the absence of dangerous behavior when the operation cannot be represented. Exact manifests also make source review, kill switches, tests, and UI explanations concrete.

## Consequences

- Internal composition is not treated as a connector capability.
- Connector adapters cannot receive a generic authenticated client escape hatch.
- New capabilities require schema, policy, documentation, and denial-path tests.
- Platform-specific logic must be named rather than hidden in a generic connector.
- Every source capability fails closed.

## Revisit when

A new source or effect has a named user need, current terms review, explicit owner approval, sanitized contract fixtures, and a narrower safe capability than the generic alternative.
