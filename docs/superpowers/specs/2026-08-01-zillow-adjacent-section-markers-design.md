# Zillow Adjacent Section Markers Design

Status: founder-approved focused compatibility design

Date: 2026-08-01

Release profile: `founder_browser_experimental`

## Goal

Repair one observed Zillow semantic-snapshot mismatch without expanding the bounded Milestone 13B
browser capability. Zillow renders each reviewed room-section name twice as an adjacent parent/child
pair: `group "Bedrooms"` followed by `text: Bedrooms`, and likewise for `Bathrooms`. The current
unique-marker check treats those two representations of one section as ambiguity and stops with
`layout_changed`.

## Selected behavior

For a reviewed section boundary, the parser may coalesce exactly two matches only when they are
adjacent, ordered `group` then `text`, and have the exact same cleaned name. A start boundary ends
after the child text marker; an end boundary begins at the parent group marker. The existing
single-marker shape remains accepted.

Every other shape fails closed: separated markers, reversed roles, mismatched names, missing
markers, or any additional matching marker. An exact `group` adjacent to a differently named text
child is also rejected rather than treated as a valid single marker.

## Preserved boundaries

The change does not alter the tool contract, saved-profile fields, hostname/path allowlist,
browser actions, navigation, run limits, consent-tab binding, policy checks, cancellation checks,
or ingestion pipeline. It adds no selector, coordinate, JavaScript, screenshot, download, upload,
login, CAPTCHA, Contact, Apply, Tour, Message, Phone, Email, or payment capability.

The Milestone 13A image and candidates 5 and 6 remain immutable rollback artifacts. Exactly one
seventh candidate may be published after the focused PR and hosted CI are green.

## Verification

Focused tests cover the observed adjacent parent/child markers and prove selection of the exact
saved bedroom and bathroom references. Separate cases prove fail-closed behavior for separated,
reversed, mismatched, and additional duplicate markers, with no numeric or forbidden action sent.
The affected unit, contract, policy, restart, route-isolation, supply-chain, remote-extension, and
release-workflow gates remain green before publication.
