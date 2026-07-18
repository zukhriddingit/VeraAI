# Connector and Manual Ingestion Design

Status: approved for implementation  
Reviewed: 2026-07-17

## Goal

Implement the first half of Vera Milestone 3: a pluggable, policy-gated capture pipeline that accepts sanitized fixtures or content supplied directly by the user, preserves immutable raw evidence idempotently, queues deterministic normalization, records field-level known and unknown outcomes, and exposes capture and connector status in the local web application.

This milestone performs no URL fetch, browser action, email access, or LLM call.

## Scope

### Included

- Strict connector, capture, normalization, job, status, and policy schemas.
- `SourceConnector`, `ConnectorContext`, `CaptureRequest`, `CaptureResult`, `RawListingEnvelope`, `NormalizationResult`, typed connector errors, and `SourcePolicyRegistry`.
- Sanitized JSON fixture capture.
- Manual URL-plus-text capture.
- Manual structured-JSON capture, with an optional provenance URL.
- Fail-closed source-policy evaluation before connector capture.
- A future-safe URL validator and deterministic domain classifier.
- Immutable, content-hashed, idempotent raw evidence.
- A durable SQLite normalization queue with one-worker leases and bounded retries.
- Deterministic baseline normalization and explicit unknown fields.
- Per-field provenance for both known and unknown normalization outcomes.
- Append-only activity events for capture and normalization.
- Local capture API, status API, capture UI, and connector-status page.

### Excluded

- Server-side URL retrieval, redirects, previews, remote images, or metadata requests.
- Browser execution or navigation.
- Gmail, Calendar, notifications, OAuth, credentials, or user sessions.
- Live or fake LLM providers.
- AI extraction, repair prompts, or prompt execution.
- Dedupe, canonical stitching, ranking, and risk evaluation for newly captured records.
- Any send, apply, upload, payment, CAPTCHA, or credential-login capability.

## Architectural boundaries

`packages/domain` defines the durable schemas shared by connectors, policy, repositories, web, and worker. It remains dependent only on Zod.

`packages/policy` defines `SourcePolicyRegistry`, code-owned initial manifests, domain-policy entries, and pure fail-closed evaluation. It depends on `packages/domain` and never on connectors or a database implementation.

`packages/connectors` defines connector contracts, URL validation and classification, fixture/manual connector implementations, typed connector errors, and the pure deterministic normalizer. It depends on domain and policy contracts, and never on repositories, web, or worker.

`packages/db` persists manifests, raw captures, normalized source records, provenance, activity events, and normalization jobs. Repositories expose short synchronous transactions and lease operations.

`apps/web` composes connectors, policy, and repositories for user-triggered capture and read-only status routes. It never performs normalization work or URL retrieval.

`apps/worker` claims normalization jobs, runs the pure normalizer outside the claim transaction, and commits normalized records, provenance, job completion, and the completion audit event in a short transaction.

## Connector contracts

### Capture requests

`CaptureRequest` is a strict discriminated union with three variants:

1. `fixture` contains a sanitized fixture payload and must declare `sanitized: true`.
2. `manual_text` contains an HTTP(S) provenance URL and non-empty pasted listing text.
3. `manual_structured` contains a strict user-supplied listing object and may include an HTTP(S) provenance URL.

Structured input recognizes only the baseline fields used by this milestone: source, source listing ID, title, URL, rent in cents, beds, baths, address text, source-posted time, and contact-channel category. Unknown keys are rejected. Missing facts are not defaulted.

### Connector context

`ConnectorContext` provides injected `now()` and `createId()` functions plus the request correlation ID. It contains no repository, network, browser, secret, or policy-evaluation escape hatch.

### Raw envelope

Every connector returns a strict `RawListingEnvelope` containing:

- connector ID and required capability;
- classified source label;
- optional source listing ID and provenance URL;
- capture method;
- observed and optional source-posted timestamps;
- raw text and/or raw JSON evidence;
- safe capture metadata including `networkAccess: false` and `untrustedContent: true`.

At least one of raw text or raw JSON is required. The connector output is validated before persistence.

### Capture result

`CaptureResult` reports the correlation ID, raw-listing ID, content hash, whether the raw row was newly inserted, normalization job ID, and normalization state. A repeated identical capture reports `duplicate: true` and resolves to the existing raw row and existing job or normalized record.

### Connector errors

Connector failures use a base `ConnectorError` with an enumerable closed code and safe details. Concrete errors cover malformed payload, unsupported connector, unsupported source, invalid URL, policy denial, and capture failure. Error messages and details cannot contain raw listing content, full URLs, email addresses, or phone numbers.

## URL validation and domain classification

Manual URLs are provenance labels only. Parsing a URL must not perform DNS resolution, open a socket, follow a redirect, load a preview, or invoke a browser.

The validator accepts only `http:` and `https:` URLs and rejects:

- username or password components;
- fragments;
- explicit ports;
- `localhost`, `.localhost`, `.local`, and single-label hostnames;
- IPv4 and IPv6 literals, including alternate textual forms accepted by the platform URL parser;
- malformed or empty hostnames;
- overlong URLs.

Known domains use exact host or dot-boundary subdomain matching:

| Domain suffix | Classification |
| --- | --- |
| `zillow.com` | `zillow` |
| `facebook.com` with a Marketplace path | `facebook_marketplace` |
| `craigslist.org` | `craigslist` |
| `apartments.com` | `apartments_com` |

Any other syntactically public hostname is classified as `other`. Manual capture remains allowed because no network capability is requested. The result records `browserAccess: manual_policy_required`; it cannot be converted into a future `browser.capture` request unless an explicit reviewed domain-policy entry exists and the browser connector is separately enabled.

## Source policy registry

`SourcePolicyRegistry` owns validated manifests and explicit domain-policy entries. Registration rejects duplicate connector/version pairs. Evaluation receives a connector ID, exact namespaced capability, execution mode, and non-network operation descriptor.

Evaluation follows the normative closed order:

1. Validate the request and capability.
2. Resolve a supported manifest version.
3. Deny active global or connector kill switches.
4. Deny disabled manifests.
5. Require the exact capability and execution mode.
6. Require the exact operation; network fields must be absent for fixture/manual capture.
7. Require session and approval state when a manifest calls for them.
8. Deny every exception or registry error.

The initial registry contains:

- an enabled manual/test fixture manifest granting only `fixture.read`;
- an enabled manual capture manifest granting only `manual.capture`;
- disabled manifests for future source-specific or network connectors.

The user clicking the capture form is the user initiation for `manual.capture`; it is not an external-effect approval and does not create an `Approval` row.

## Persistence changes

### Existing evidence tables

The raw-listing capture-method vocabulary expands from fixture-only to `fixture`, `manual_text`, and `manual_structured`. Source labels add `other`. Existing append-only triggers remain unchanged.

`listing_source_records` adds:

- `source_posted_at`, nullable;
- `contact_channel`, using `email`, `phone`, `platform_message`, `website_form`, `other`, or `unknown`.

`field_provenance` adds:

- `value_status`, using `known` or `unknown`;
- `unknown_reason`, nullable and required only when status is unknown.

Existing seed provenance migrates as `known`. New normalization creates a provenance row for every baseline field, including unknown fields with zero confidence and a reason code.

### Normalization jobs

`normalization_jobs` contains:

- stable ID and unique idempotency key;
- raw-listing foreign key and job type;
- `queued`, `leased`, `completed`, `retryable`, or `dead_letter` state;
- available time, attempt count, and maximum attempts;
- lease owner and expiry;
- safe last-error code and category;
- correlation and causation event IDs;
- created, updated, and completed timestamps.

One raw listing has at most one normalization job. Claiming occurs in a short immediate SQLite transaction. The worker performs no parsing inside the claim transaction. A completed job cannot be reclaimed. An expired lease is reclaimable. A failure returns the job to `retryable` with bounded backoff until the maximum attempt moves it to `dead_letter`.

## Capture flow

1. The API generates a correlation ID and hashes the request without logging its evidence.
2. It appends `capture.requested` with safe metadata.
3. It resolves the requested connector and evaluates policy before calling it.
4. It appends `capture.policy_authorized` or `capture.policy_denied`.
5. On allow, the connector validates and returns a raw envelope without performing I/O.
6. In one repository transaction, the API imports raw evidence idempotently, enqueues normalization if needed, and appends `capture.completed`.
7. It returns HTTP 202 with the typed capture result. Duplicate captures resolve to the existing row and do not enqueue duplicate work.
8. Any failure appends `capture.failed` when an audit repository is available, then returns a sanitized typed error response.

Malformed input produces requested and failed events if the database is initialized. It does not produce a policy decision because no valid capability request exists. Policy denial produces requested, denied, and failed events.

## Deterministic normalization

The normalizer consumes only a validated raw envelope or persisted raw capture. Structured values are accepted exactly after schema validation. Text extraction uses bounded, deterministic rules for:

- canonicalized provenance URL and classified source;
- common dollar rent forms;
- `studio`, bed, and bath expressions;
- an explicitly labeled address line;
- ISO date or clearly labeled post-date text;
- contact-channel category based on explicit email, phone, platform-message, or web-form evidence.

The normalizer never stores extracted contact details in the normalized record or audit log. It never follows instructions contained in listing text. Content that resembles commands, policy requests, or prompt instructions is inert text.

Every baseline field becomes a `NormalizedField<T>`:

- known: value, extraction method, confidence basis points, observed time, optional bounded evidence excerpt;
- unknown: `value: null`, confidence zero, observed time, and a closed unknown-reason code.

The persisted `ListingSourceRecord` uses nullable values or the explicit contact-channel `unknown` enum. A system display label such as `Captured listing` may be used when no factual title exists, but the title provenance remains unknown so the label is not represented as a source fact.

## Activity events

All events share one correlation ID and use canonical request or evidence hashes. Required action names are:

- `capture.requested`;
- `capture.policy_authorized` or `capture.policy_denied`;
- `capture.completed`;
- `normalization.completed`;
- `capture.failed`.

The normalization event uses the capture-completed event as its causation ID. Safe event metadata may contain connector ID, capability, source classification, inserted/duplicate state, raw-listing ID, job ID, field counts, and error code. It excludes content, URLs, contact data, and raw structured payloads.

## API and UI

### Routes

- `POST /api/captures` submits a strict capture request and returns 202, 400, 403, 422, or 503 with typed JSON.
- `GET /api/captures/:rawListingId` returns queued, processing, completed, failed, or duplicate-resolved status plus normalized known/unknown field summaries.
- `GET /api/connectors` returns connector health, policy state, capabilities, and the explicit statement that network access is disabled.

All routes use the Node runtime, disable caching, open only the existing local database, and close the connection in `finally`.

### Pages

`/capture` provides accessible tabs or radio controls for URL-plus-text and structured JSON. It validates locally for usability and relies on server validation for authority. After a 202 response it polls the status route until completion or a visible failure.

`/connectors` lists fixture and manual connectors as local/no-network, displays enabled or denied policy state, and explains that unknown domains require a future manual policy review before browser use.

No control implies that Vera fetched a URL. Copy consistently says that the URL is provenance and the pasted content is what Vera stores.

## Testing strategy

### Unit tests

- Shared connector contract tests for fixture and manual connectors.
- Strict malformed-payload and unsupported-connector/source tests.
- URL classification and SSRF-shaped input tests.
- Policy allow, denial, missing manifest, malformed manifest, kill-switch, and unknown capability tests.
- Deterministic text and structured normalizer tests, including explicit unknown fields and inert prompt-like content.

### Integration tests

- Duplicate capture yields one immutable raw row and one normalization job.
- Authorized capture writes the requested, policy, and completed events.
- Denial and malformed input write the expected failed audit chains.
- Worker normalization writes one source record and provenance for every baseline field.
- Known and unknown provenance round-trip through SQLite.
- Job claim, completion, bounded retry, dead-letter, and expired-lease recovery.
- Capture and connector route responses against a temporary migrated database.

### End-to-end tests

- The connector page shows fixture/manual health and no-network status.
- A user submits pasted text with a provenance URL, sees queued/processing state, and eventually sees normalized known and unknown fields.
- Repeating the same capture reports a duplicate and does not increase the raw-listing count.

## Acceptance criteria

The milestone is complete only when:

1. Every required named interface is exported and covered by compilation or contract tests.
2. Fixture and both manual capture modes work without network access.
3. Every capture is policy-evaluated before connector execution.
4. Duplicate evidence creates neither a second raw row nor a second job.
5. The worker completes deterministic normalization with complete known/unknown provenance.
6. Required activity-event chains are persisted without sensitive content.
7. Connector and capture UI flows work in Playwright.
8. Browser, email, and LLM dependencies and code paths are absent.
9. Formatting, lint, typecheck, unit tests, integration tests, E2E tests, and build all pass.
