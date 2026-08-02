# Zillow Consolidated Filters Compatibility Design

Status: founder-approved focused compatibility design

Date: 2026-08-02

Release profile: `founder_browser_experimental`

## Goal

Support Zillow's observed Boston rentals header, which exposes one exact `button "Filters"`
instead of the previously reviewed standalone `Price` and `Beds & Baths` buttons, without widening
`vera_zillow_rental_research_v1` or weakening any Milestone 13A/13B boundary.

## Selected behavior

The existing standalone-filter flow remains unchanged. When and only when the unique reviewed Price
button is absent, the adapter may select one unique exact `button "Filters"`, take a fresh semantic
snapshot, and use the existing saved-profile values to set the reviewed maximum-rent, bedroom,
bathroom, and property-type controls inside that dialog. It activates a reviewed `Done`, `Save`, or
`See N rentals available` control once after all supplied fields are set.

The fallback never accepts arbitrary filter labels, selectors, coordinates, URLs, JavaScript, or
action sequences. Missing, duplicated, reordered, or ambiguous dialog controls fail closed as
`layout_changed`. Login, 2FA, CAPTCHA, consent, bot challenge, and blocked-page detection remains
manual-action-only.

## Data flow and policy

Each dialog action uses the existing `set_reviewed_filter` operation and therefore rechecks founder
authorization, the experimental-personal/user-triggered-only policy, browser kill switch,
cancellation, exact shared tab, Zillow hostname, and run limits. Output remains strict observed
listing JSON and enters the unchanged RawListing, normalization, provenance, deduplication,
scoring, and inbox pipeline.

## Verification and release

Focused tests cover both standalone and consolidated layouts, exact saved-profile values, a single
final apply action, ambiguous/missing controls, and no forbidden action text. Existing contract,
policy, restart, consent-tab, route-isolation, supply-chain, remote-extension, and release gates must
remain green. Candidate 8 is built only from merged green main, signed and attested, scanned with
zero HIGH/CRITICAL findings, and deployed to the existing disposable 13A-shaped acceptance stack.
All prior immutable digests remain rollback artifacts.
