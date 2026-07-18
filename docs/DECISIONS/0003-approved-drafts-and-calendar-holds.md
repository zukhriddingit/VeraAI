# ADR 0003: Payload-bound approvals, Gmail drafts, and private calendar holds

- Status: Accepted
- Date: 2026-07-17

## Context

Vera's highest-risk product actions are communicating with a landlord and writing to a calendar. The user must understand and approve the exact effect. Retries must not duplicate drafts or events.

Gmail's compose OAuth scope can authorize sending as well as draft creation, so provider scopes cannot enforce Vera's narrower promise by themselves.

## Decision

An approval is single-use, expires after 15 minutes, and binds:

- actor;
- connector and operation;
- target;
- canonical payload hash;
- creation and expiry times.

Any edit invalidates the approval.

The Gmail adapter exposes only drafts.create. Vera has no send capability, adapter method, route, job, UI control, or test helper.

The Calendar adapter creates only a tentative private hold with:

- deterministic event ID;
- exact approved start, end, and time zone;
- empty attendees;
- no conference data;
- sendUpdates=none.

The user may reach the hold flow only after a real reply is parsed and reviewed or after explicit user input. A proposed time is never treated as confirmed without review.

Each request, policy decision, approval, and provider outcome is a separate immutable activity event.

## Rationale

Binding approval to exact bytes prevents a stale approval from authorizing edited content. Removing send from every application layer is stronger than hiding a button. An attendee-free calendar event avoids relying only on notification flags.

## Consequences

- Gmail read and compose grants are connected incrementally and stored separately.
- The compose token retains provider-level send risk if stolen; SECURITY.md documents the compensating controls.
- Retry logic must resolve ambiguous outcomes through provider IDs before creating again.
- The UI must distinguish preview ready, draft created, and policy denied.
- Invitations and attendee notifications require a future capability and decision.

## Tests required

- Mismatched, edited, expired, or reused approval denies.
- Gmail adapter surface and outbound-operation allowlist contain no send operation.
- Calendar payloads with attendees or conference data deny.
- Repeated action requests create at most one provider-side effect.
