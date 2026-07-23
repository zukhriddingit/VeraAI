# ADR 0003: Payload-bound approvals, Gmail drafts, and private calendar holds

- Status: Accepted
- Date: 2026-07-17
- Updated: 2026-07-21

Implementation status (2026-07-22): the Calendar half is implemented. Hosted Gmail currently supports only narrow `gmail.readonly` listing-alert ingestion. The draft-only adapter and `gmail.compose` grant described below remain an accepted target boundary, not current repository capability.

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

When implemented, the Gmail draft adapter may expose only `drafts.create`. Vera has no send capability, adapter method, route, job, UI control, or test helper today, and adding the draft adapter must preserve that absence.

The Calendar adapter creates only a tentative private hold with:

- deterministic event ID;
- exact approved start, end, and time zone;
- empty attendees;
- no conference data;
- sendUpdates=none.

Calendar availability follows Option C, graceful but visible degradation:

- Vera requests `calendar.freebusy` only when conflict checking is enabled and checks only the connected account's primary calendar;
- Vera requests `calendar.events.owned` separately only when hold creation is enabled or first used;
- a successful check intersects primary-calendar free/busy with Vera's weekly availability, notice, duration, travel, and buffer rules;
- a missing, revoked, stale, or temporarily unavailable check may produce rules-only windows, but the UI must say **Calendar conflicts not checked** and must not claim they are conflict-free;
- raw busy intervals and event details are neither fetched nor persisted; only bounded check provenance is retained;
- Vera rechecks the selected interval immediately before creating a hold. A new conflict blocks creation. An unavailable final check requires a fresh exact approval containing the visible warning and override reason.

Founder-release reschedule and cancellation change Vera's internal viewing state first and do not update or delete a Google event. That external capability requires a later decision.

The user may reach the hold flow only after a real reply is parsed and reviewed or after explicit user input. A proposed time is never treated as confirmed without review.

Each request, policy decision, approval, and provider outcome is a separate immutable activity event.

## Rationale

Binding approval to exact bytes prevents a stale approval from authorizing edited content. Removing send from every application layer is stronger than hiding a button. An attendee-free calendar event avoids relying only on notification flags. Option C keeps suggestions useful without presenting an unavailable provider as an empty or conflict-free calendar, while the final recheck limits the risk of acting on stale availability.

## Consequences

- Gmail read and compose grants are connected incrementally and stored separately.
- The compose token retains provider-level send risk if stolen; SECURITY.md documents the compensating controls.
- Retry logic must resolve ambiguous outcomes through provider IDs before creating again.
- The UI must distinguish preview ready, draft created, and policy denied.
- Invitations and attendee notifications require a future capability and decision.
- The UI must distinguish a checked primary calendar, a stale result, a temporary provider failure, and Vera-rules-only suggestions.
- Multi-calendar selection is deferred; Vera must not imply that all calendars were checked.
- The Google `calendar.events.owned` grant is broader than Vera's insert-only adapter, so application encryption, incremental consent, narrow adapter methods, audit, disconnect, and revocation remain compensating controls.

## Tests required

- Mismatched, edited, expired, or reused approval denies.
- Gmail adapter surface and outbound-operation allowlist contain no send operation.
- Calendar payloads with attendees or conference data deny.
- Repeated action requests create at most one provider-side effect.
- Missing/partial/revoked free-busy grants and transient failures produce explicit degraded states with no silent fallback.
- Conflicts and required buffers remove candidate windows, including daylight-saving boundaries.
- A new conflict before creation blocks the hold; a failed final check needs a newly payload-bound override approval.
- Calendar cancellation and rescheduling make no update/delete provider call.
