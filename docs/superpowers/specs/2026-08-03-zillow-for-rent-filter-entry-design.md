# Zillow For-Rent Filter Entry Design

## Problem

Candidate 8 correctly failed closed after Zillow's current top-level `Filters` button opened a
`More filters` panel that contains amenities and listing details, but no price, bedroom, or
bathroom controls. The accepted standalone `Price` path remains valid for older layouts. The live
result surface also exposes one exact `For rent` button, which is the narrow reviewed entry point
for the current rental criteria panel.

## Considered approaches

1. **Prefer exact `For rent` entry, retain existing fallbacks (selected).** Close only an already
   open, uniquely identified `More filters` panel, then prefer one exact `For rent` button before
   the existing standalone `Price` or legacy consolidated `Filters` paths. This is the smallest
   semantic change and preserves fail-closed behavior.
2. Encode Zillow query parameters directly. Rejected because it would create model-independent but
   unobserved navigation state and weaken the reviewed-control boundary.
3. Treat every button containing `rent` or `filter` as an entry point. Rejected because it is
   ambiguous and could select owner, availability, application, or unrelated controls.

## Design

At the start of saved-profile application, detect the exact live stale-panel signature: one
`heading "More filters"` and one `button "Close"`. Close it through the existing
`activateControl` path, so checkpoint authorization, kill-switch/cancellation checks, exact-tab
pinning, hostname validation, limits, and safe audit hashing are re-run. Any duplicate or partial
signature returns `layout_changed` without an action.

After the location is submitted, preserve the existing exact standalone `Price` path. When no
standalone price button exists, prefer exactly one `button "For rent"` as the consolidated entry.
Only if no `For rent` button exists may the existing exact `Filters` fallback run. Duplicate entry
controls fail closed. The existing strict maximum-rent, room-section, property-type, and result-count
apply contracts remain unchanged.

No schema, URL allowlist, browser operation, credential, pairing, consent-tab, route, UID/GID,
restart, timeout, result/detail cap, or forbidden-action behavior changes.

## Tests and acceptance

Add unit coverage for stale-panel closure, current `For rent` preference, duplicate/partial stale
panel signatures, duplicate `For rent` controls, preservation of the legacy consolidated path, and
absence of forbidden actions. Run the focused adapter suite, affected boundary/restart suites,
lint, typecheck, formatting, hosted CI, and the existing signed immutable release gates. Deploy one
new digest and rerun the real founder Boston acceptance.
