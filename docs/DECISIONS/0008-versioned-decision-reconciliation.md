# ADR 0008: Versioned deterministic decision reconciliation

- Status: Accepted
- Date: 2026-07-20

## Context

Vera must turn normalized source records into user-facing duplicate clusters, canonical listings, fit scores, and risk indicators. These results affect renter attention and safety, so a seed-only or UI-local implementation is not acceptable. New evidence, preference changes, and operator merge/split corrections must produce the same explainable result after a retry or process restart without deleting provenance or corrupting user workflow state.

The existing queues have different responsibilities. `source_jobs` orchestrates acquisition before immutable evidence exists. `normalization_jobs` transforms one accepted raw record into one normalized source record and provenance. Neither is the right unit for a corpus-wide deduplication and ranking decision.

## Decision

Use one provider-independent deterministic engine in `packages/scoring` for production, fixtures, CLI evaluation, and tests. Remove the separate `demo-fit` and `demo-risk` implementation.

The engine consumes one strict `DecisionCorpusSnapshot` and returns one strict `DecisionPlan`. It performs:

1. US-focused address/unit, phone, URL, rent/fee, date, and supplied-photo normalization;
2. bounded duplicate candidate generation;
3. deterministic exact links and conflicts plus versioned weighted pair features;
4. connected-components clustering with append-only force-merge/force-split overrides;
5. canonical stitching using freshness, completeness, confidence, and source trust;
6. deterministic hard constraints, unknown handling, renormalized explicit preferences, and separate stale/confidence/risk penalties; and
7. evidence-backed risk indicators with verification actions and no categorical scam verdict.

The evaluator is pure, order-stable, and no-network. Every algorithm/config input and output is schema-validated, versioned, canonically hashed, and stored in basis points or normalized integer units where practical. Candidate generation fails visibly if its safety bound would be exceeded.

Each search profile has a monotonic corpus revision. A committed source record or accepted override increments the revision and enqueues one `decision_job` for that exact profile/revision. The worker leases the job, reads an ordered snapshot, computes outside the database transaction, and atomically applies the complete plan only when both the lease and corpus revision still match.

Accepted output creates immutable run, attempt, pair-evaluation, canonical-stitch, score, and risk history. Current canonical and cluster rows are projections. Canonical IDs survive unambiguous overlap; losing projections are marked `superseded` and point to the survivor. Existing raw listings, source records, provenance, decisions, and user workflow state are never silently deleted. Overrides are append-only and reversals append a revocation.

The sanitized seed inserts evidence only and queues reconciliation. Product commands, Railway bootstrap, the dashboard, and listing detail use production-derived decisions. Fixture evaluation reports precision/recall for all labeled pairs, cluster/risk counts, algorithm versions, and same-input determinism while explicitly disclaiming production-performance inference from the small corpus.

## Persistence decision

Forward migration `0005_production_decision_engines.sql` preserves all migration-0004 data. It adds corpus/job/run/history/override tables and additive version-2 score, risk, canonical projection, coordinate, and photo metadata. Legacy score/risk rows remain readable. New decision histories and scores receive database-level update/delete rejection triggers.

SQLite remains a one-worker local persistence boundary. It is not the Maritime acquisition control plane. A future hosted or multi-user deployment must revisit queue and database ownership without changing the pure decision contracts.

## Security and privacy decision

- Every connector result remains untrusted; strict normalization precedes all decisions.
- No source URL or image is fetched for scoring or deduplication.
- Photo decoding accepts only already-supplied bytes under explicit resource limits.
- Raw contacts, evidence text, credentials, cookies, and browser state do not enter decision jobs, histories, activity metadata, or logs.
- Risk output is an indicator with exact evidence and a verification action, never a definitive accusation.
- Operator APIs accept only typed opaque references and bounded rationale; they queue recomputation rather than mutating clusters directly.

## Consequences

- A manual capture becomes visible in canonical results only after normalization and reconciliation both succeed.
- Corpus changes may supersede a canonical projection, but historical runs explain why and redirect to the active identity.
- Threshold or semantic changes require an explicit algorithm/config version change and regression review.
- Comparative signals such as price outliers depend on the current profile result set and are recomputed with its revision.
- The current source projection does not feed persisted contact fingerprints into reconciliation. Adding contact matching from real data requires a separate keyed-fingerprint storage and rotation decision.
- The fixture corpus is a deterministic regression suite, not statistical evidence of real-world precision, recall, or safety performance.

## Alternatives rejected

- **Keep the demo scorer beside the production scorer:** rejected because results and safety language would drift.
- **Mutate clusters incrementally inside normalization:** rejected because one-record transactions cannot observe or atomically reconcile the full corpus.
- **Use an LLM for matching, constraints, score reasons, or risk verdicts:** rejected because these decisions must be reproducible, bounded, and evidence-backed.
- **Delete and recreate canonical listings on every run:** rejected because it loses stable identity and can orphan workflow state.
- **Overwrite score/risk rows:** rejected because versioned explanations and rollback investigation require immutable history.
- **Fetch remote images for perceptual hashes:** rejected because it adds hidden network access, policy risk, and SSRF/resource-exhaustion exposure.
