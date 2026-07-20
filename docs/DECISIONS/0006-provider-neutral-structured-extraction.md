# ADR 0006: Deterministic-first provider-neutral structured extraction

- Status: Accepted
- Date: 2026-07-17

## Context

Manual listing text is often incomplete or inconsistently formatted. Vera needs richer structured facts without making a model the authority for policy, evidence, or external actions. The product must remain fully usable without credentials, and a configured provider must not overwrite stronger structured or deterministic provenance.

New captures are still source records in this milestone. Creating a canonical listing for every capture would silently pull deduplication and canonicalization into the extraction boundary and misrepresent a single observation as a stitched result.

## Decision

Use a provider-neutral `LLMProvider` interface in `packages/ai`. The initial live implementation uses the official OpenAI JavaScript SDK 6.48.0, the Responses API, and strict Zod structured output. Tests use `MockLLMProvider`, which is deterministic and makes no network request. The production worker never substitutes the mock automatically.

Run extraction in this order:

1. Serialize only the supplied listing evidence deterministically and hash the exact provider input.
2. Run structured and deterministic rules first.
3. Request provider help only for fields that remain absent, ambiguous, conflicting, or unrecognized.
4. Parse the response through the strict 20-field `ListingExtraction` schema.
5. Validate evidence snippets, requested-field membership, confidence, contacts, money, fees, availability, and pets with deterministic code.
6. Allow exactly one complete schema/evidence repair response.
7. Merge with closed precedence: structured input, deterministic rule, then a valid provider value for a requested gap.
8. Persist the source record, complete provenance, immutable extraction run, safe activity event, and job completion atomically.

The extraction modes are exactly `deterministic_only` and `llm_augmented`. `listing_extractions` is one-to-one with both its raw listing and source record, exposes no mutation repository methods, and has SQLite update/delete rejection triggers.

Live configuration is fail-closed:

- both `OPENAI_API_KEY` and `VERA_LLM_MODEL` absent means deterministic-only mode;
- both present enables OpenAI with the exact environment-selected model;
- only one present is a configuration error;
- `VERA_LLM_TIMEOUT_MS` defaults to 20,000 and is constrained to 1,000–30,000 milliseconds;
- SDK retries are zero because the durable worker owns bounded retry decisions;
- requests set `store: false`, expose no tools, and receive the caller's abort signal.

The worker performs provider calls outside SQLite transactions. Typed timeout, rate-limit, and transient failures are retryable. Authentication, refusal, invalid-after-repair, configuration, and permanent provider failures dead-letter immediately at the real attempt count. Shutdown cancellation leaves the lease recoverable and writes no partial extraction.

Prompt and extraction semantics start at `listing-extraction.prompt.v1` and `listing-extraction.v1`. Extraction semantics `listing-extraction.v2` add deterministic monetary-role checks: base-rent evidence must identify rent, and recurring-fee evidence must bind each label and amount under explicit required context. Persisted v1 runs remain readable. Any material instruction, validation, field-semantic, or merge-policy change requires an intentional version change.

## Privacy and audit decision

Local extraction rows may contain contact values that occur in user-supplied evidence. Prompts, raw model output, evidence snippets, credentials, contact values, request/response bodies, and full URLs never enter logs or activity metadata. Successful events record versions, mode, provider/model when applicable, counts, usage, latency, and repair count. Failure events record only safe typed outcome metadata.

## Alternatives rejected

- **Mock provider when credentials are absent:** rejected because fixtures must not masquerade as extracted product facts. Offline mode is deterministic-only.
- **Model-first parsing:** rejected because it increases cost and lets model output compete with stronger direct evidence.
- **Confidence-based overwrite:** rejected because model self-confidence is not stronger provenance.
- **Custom OpenAI HTTP client:** rejected because the official SDK already owns Responses transport, structured parsing, cancellation, timeout, and typed errors.
- **Canonical-listing detail page:** rejected because new-record canonicalization belongs to the next milestone. Evidence is shown at `/captures/[rawListingId]`.
- **Permissive fallback after invalid output:** rejected because every source capability and extraction boundary must fail closed.

## Consequences

- Default development, CI, unit, integration, E2E, build, migration, and seed paths make no model request.
- Live tests require `VERA_RUN_LIVE_LLM_TESTS=1` plus a non-empty key and model; otherwise they are skipped.
- Rich money and contact observations remain available in the protected extraction row even when the narrower source-record projection cannot safely aggregate them.
- A provider can improve missing facts but cannot authorize actions, decide policy, create canonical records, browse, or contact anyone.
- The next milestone may canonicalize and deduplicate source records without changing this extraction contract.
