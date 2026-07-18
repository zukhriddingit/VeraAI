# Vera product charter

Status: implemented through provider-neutral Milestone 3 extraction  
Reviewed: 2026-07-18

## Product goal

Vera is a renter-controlled copilot for one person's housing search, with a local privacy boundary for authenticated consumer-site sessions. It shortens the path from discovering a listing to taking a safe, informed next step: collect evidence, normalize it, detect likely duplicates, rank it against the renter's stated preferences, surface risk indicators, prepare outreach, and coordinate a viewing.

The promise is:

> Find fast. Rent safely.

Vera is useful only if the renter remains in control. It is not a listing marketplace, an autonomous agent, or a platform-scraping service.

## MVP boundary

The Ship Season MVP must provide one coherent single-user workflow:

1. Create one search profile with budget, location, bedrooms, move-in window, pet needs, commute anchors, hard constraints, and weighted preferences.
2. Acquire listings through `official_api`, `email_alert`, `local_browser`, and `user_capture` connectors. Maritime is the primary orchestration and deployment environment for monitoring jobs, scheduled triggers, retries, agent health, notifications, and hosted secrets. OpenClaw is the default replaceable adapter for approved `local_browser` sources.
3. Keep authenticated consumer-site sessions in a user-controlled local OpenClaw profile. The user signs in manually, and Vera never asks for, records, types, uploads, or transmits a third-party password.
4. Limit browser monitoring to exact reviewed saved-search URLs. Each browser connector maintains a source-specific cursor or last-seen listing ID and visits only newly discovered records.
5. Preserve immutable source evidence and process every record through normalization, provenance, deduplication, deterministic ranking, notification, and human-approved external action. Missing values remain unknown.
6. Cluster duplicate source records without deleting them.
7. Rank canonical listings using deterministic, versioned factors and explain every score.
8. Display evidence-backed risk indicators without declaring that a listing is definitively fraudulent.
9. Let the user shortlist or dismiss a listing.
10. Generate an outreach preview and, after a payload-bound approval, create a Gmail draft. Vera never sends it.
11. Accept a real reply or explicit user-entered viewing time and, after a separate approval, create a tentative calendar hold with no attendees.
12. Record material requests, policy decisions, approvals, successes, and failures as immutable activity events.
13. Pass unit, repository integration, connector contract, AI schema, and golden-path browser tests without live landlord accounts or external side effects.

The demo must represent at least three clearly labeled channels. Sanitized fixture channels count for the deterministic demo; MVP completion also requires at least one real, user-authorized ingestion path. Gmail alert ingestion is the planned real path.

Every source/mode pair has one fail-closed policy ceiling: `approved`, `user_triggered_only`, `experimental_personal`, or `disabled`. `approved` still requires a valid manifest and every runtime check. `user_triggered_only` can never be scheduled. `experimental_personal` is a single-user experiment bound to an exact reviewed saved search and remains disabled until explicitly enabled. `disabled` denies every operation.

Every acquisition path feeds the same deterministic sequence and cannot bypass a stage:

```text
source record
  -> normalization
  -> provenance
  -> deduplication
  -> ranking
  -> notification
  -> human-approved external action
```

The initial source portfolio is deliberately narrow:

- Sanitized fixture adapters are local no-network test doubles for the `official_api` contract and are `approved` for development and tests.
- General `user_capture` is `user_triggered_only`; supplied URLs are inert provenance and are not fetched implicitly.
- Craigslist starts with its official search-alert `email_alert` channel, `approved` but disabled until configured. Craigslist `local_browser` search is `disabled`.
- Zillow and Facebook Marketplace `local_browser` monitoring are `experimental_personal` and disabled by default. They may operate only on exact configured saved searches through the local OpenClaw node after explicit enablement.
- Zillow, Facebook Marketplace, and Craigslist `user_capture` remain available as direct user actions.

## Explicitly outside the MVP

- Broad website crawling, arbitrary marketplace exploration, CAPTCHA handling, stealth automation, proxy use, or anti-bot evasion. Browser monitoring is limited to reviewed saved-search URLs and newly discovered IDs.
- Autonomous marketplace messages, email, SMS, voice calls, applications, uploads, document submission, identity checks, payments, deposits, or account changes.
- Password collection, credential replay, or automated account login. Consumer-site login remains a manual action in the user's local browser profile.
- Multi-user accounts, hosted tenancy, billing, teams, or a multi-tenant SaaS control plane.
- A mobile app, a nationwide inventory, or a proprietary neighborhood data product.
- Protected-class inference, demographic steering, or neighborhood desirability scores.
- A binary scam verdict.
- CSV/JSON upload, commute-routing integrations, Telegram alerts, and unreviewed live structured-provider integrations.

## Five primary safety invariants

1. **The user controls every external effect.** Vera may prepare content, but it cannot send a message, apply, pay, invite a landlord, or create a calendar hold without an explicit approval bound to the exact payload.
2. **Capabilities fail closed.** A connector or action is denied when its manifest is missing, invalid, disabled, killed, out of scope, outside its allowlist, or missing a required approval. Login, 2FA, CAPTCHA, consent, camera, and microphone prompts always stop automation. If an assigned local browser node is offline, Maritime records and displays `deferred_local_node_offline`; it creates no raw listing or success event and does not advance the source cursor.
3. **Evidence is preserved without invention.** Raw captures are immutable; every normalized value identifies its evidence and observation time; unknown stays unknown; duplicates are clustered rather than destroyed.
4. **Safety-relevant decisions are deterministic.** Code, not an LLM, enforces hard constraints, source policy, state transitions, idempotency, score math, and side-effect rules. Structured AI output is validated, repaired once at most, and then fails visibly.
5. **Private actions are minimal and auditable.** Vera never requests or transmits third-party passwords. Consumer-site sessions, cookies, and browser-profile contents remain in the user-controlled local OpenClaw profile; Maritime stores only secrets required by approved hosted API and email connectors. Local tokens use the OS credential store, logs are redacted, and each material request, decision, approval, outcome, and error produces an immutable event.

## Core user experience

The dashboard is answer-first:

- New and strong matches appear before analytics.
- Observed time, source-posted time when known, and discovery-to-alert latency are visible.
- Unknown and stale fields are visibly different from negative values.
- Duplicate members and the chosen canonical evidence remain inspectable.
- Every score has factor-level reasons and a version.
- Every risk indicator links to exact evidence and a verification step.
- Approval controls sit beside the exact action they authorize.
- “Preview ready,” “Gmail draft created,” and “message sent” cannot be confused. The last state does not exist in Vera.

## Success criteria

The MVP is demo-ready when a new contributor can follow the repository instructions and complete the golden flow from a clean clone using sanitized data; verify Maritime scheduling, health, retry, notification, and visible local-node deferral behavior; exercise the OpenClaw bridge through a policy-reviewed saved-search contract; and then opt into a real Gmail test without changing code. Live consumer-site credentials are not required by the automated test suite.

Product learning should focus on:

- source-observed-to-alert latency;
- extraction accuracy on labeled fixtures;
- duplicate-cluster precision and correction rate;
- shortlist rate among top-ranked results;
- draft approval, edit, and rejection rate;
- viewing conversion;
- risk-indicator confirmation and false-positive rate;
- external-action error rate;
- connector health;
- estimated manual minutes saved.

Inventory size is not an MVP success metric.

## Readiness statement

The local vertical skeleton, domain/persistence layer, sanitized fixture path, fail-closed policy registry, manual-capture gateway, deterministic-first provider-neutral extraction, immutable extraction runs, durable job processing, and capture evidence UI are implemented. Default operation needs no credentials and makes no model request. No product question blocks deterministic duplicate clustering and canonicalization of newly captured source records.

The current clean clone still runs fixture and user-capture jobs locally. Maritime orchestration, remote dispatch, email-alert ingestion, and the local OpenClaw bridge remain implementation work; they are required MVP architecture, not later-stage experiments.

Real Gmail and Calendar acceptance will later require a founder-owned Google Cloud project, OAuth client configuration, and a non-production test account. These are external-integration prerequisites, not reasons to delay the credential-free core.
