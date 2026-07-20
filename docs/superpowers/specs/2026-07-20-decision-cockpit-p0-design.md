# Decision Cockpit P0 Design

Status: approved for immediate implementation  
Date: 2026-07-20

## Goal

Deliver a reliable, recordable deadline-demo cockpit that helps a renter scan the seeded search, run the deterministic fixture search, inspect ranked canonical listings and duplicate evidence, shortlist or dismiss a listing, and verify those actions in the audit log.

## Approved product boundary

The root route uses the selected inbox-first triage-rail layout. Demo mode starts directly with the existing seeded search profile. `/listings/[id]` remains the evidence workspace. `/onboarding` is reserved for a later production first-run milestone and is not implemented here.

This slice does not add profile editing, profile versions, rescoring queues, operational APIs, `/operations`, browser-node health, connector retries, developer source settings, migrations, new connectors, Gmail, Calendar, Maritime, OpenClaw, browser automation, or message/send actions.

## Architecture

Initial cockpit, listing-detail, and activity read models are produced on the server from existing SQLite repositories and parsed by shared Zod response schemas. Client components are limited to demo-search execution, filters and sorting, shortlist/dismiss actions, and visible loading/error feedback after an interaction.

The existing deterministic fixture connector and synchronous demo-search service remain the only acquisition path exercised by the cockpit. The seeded profile is read-only. Scores, duplicate clusters, risks, provenance, and canonical listings continue to come from the production decision evaluator that already runs during seed preparation.

Dismiss uses the existing lifecycle state machine and repository transition. A narrow request/response schema and route append `listing.dismissed` to the existing activity log in the same transaction. There is no restore path because `dismissed` is already a terminal lifecycle state; the UI confirms the consequence before submitting.

## Inbox experience

The desktop layout has a calm search-summary/filter rail and a primary listing stream. Mobile collapses the rail above the stream. The inbox provides All, New, Shortlisted, Contacted, Tours, and Archived tabs; Contacted and Tours are read-only views over existing lifecycle states.

Sorting is client-side over the bounded MVP collection: fit descending, freshness descending, total known monthly cost ascending, or open risk indicators descending. Filters cover eligibility, missing facts, source, and duplicate status. Unknown monetary totals stay visibly partial instead of treating unknown fees as zero.

Each card contains a safe photo placeholder because Vera has no approved downloaded canonical-photo asset in the current persistence path. It shows address, monthly total or partial cost, beds/baths, move-in, pet status, score, top positive and concern reasons, risk count, duplicate sources, observed time, and actions. No remote image URL is loaded.

## Detail and audit

The detail page preserves stitched values, score constraints and penalties, risk evidence and verification actions, every source record, field provenance, deterministic duplicate explanation, missing-information checklist, and listing activity. “Prepare outreach” remains visibly disabled.

The activity page shows the initial server-rendered append-only events and refreshes only after client-driven navigation. Shortlist and dismiss actions must appear as safe audit events.

## Error and accessibility behavior

An unavailable database renders a command-oriented recovery state instead of crashing. Demo execution and lifecycle mutations expose busy, success, and error states. Tabs use button semantics with `aria-pressed`; filter controls have labels; card actions have listing-specific accessible names; focus styles remain visible; status updates use polite live regions; reduced-motion preferences disable nonessential motion.

## Acceptance

1. A fresh demo starts with the seeded profile summary and an enabled Run demo search button.
2. Running the search displays eight canonical homes and three duplicate badges.
3. Tabs, filters, and all four sorts deterministically change the visible list without refetching.
4. Juniper detail displays three sources, duplicate evidence, score reasons, two risk indicators, provenance, missing facts, and a disabled outreach control.
5. Shortlisting persists and creates an activity event.
6. Dismissing a valid listing persists, removes it from the active inbox tab, and creates an activity event.
7. No UI exposes send, Gmail, Calendar, browser automation, kill-switch mutation, credentials, phone links, or email links.
8. Typecheck, relevant tests, full tests, build, and Playwright pass.
