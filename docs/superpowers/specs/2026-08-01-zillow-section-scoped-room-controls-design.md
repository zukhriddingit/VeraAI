# Zillow Section-Scoped Room Controls Design

Status: founder-approved focused compatibility design  
Date: 2026-08-01  
Release profile: `founder_browser_experimental`

## Goal

Repair one live Zillow compatibility mismatch without broadening the accepted Milestone 13B
browser boundary. Zillow currently exposes Beds/Baths choices as bare semantic button names such as
`2+` and `1.5+`; the reviewed adapter expects names such as `2 Bedrooms` and `1 Bathrooms` and
therefore stops with `layout_changed`.

The repair must select only the saved profile's exact bedroom and bathroom values in their
respective semantic sections. It must not treat a bare numeric control anywhere on the page as
safe.

## Selected design

The snapshot parser will add a section-scoped reviewed-control lookup for the existing Zillow
Beds/Baths flow. It will derive section membership only from the bounded semantic snapshot and
exact whitelisted section labels observed by a sanitized control-shape diagnostic. It will not use
CSS selectors, coordinates, JavaScript evaluation, DOM execution, or model-supplied input.

The adapter will:

1. open the already-reviewed `Beds & baths` control;
2. locate the exact reviewed bedroom section;
3. match only the normalized saved minimum-bedroom value, for example `2+`;
4. locate the exact reviewed bathroom section when a saved minimum is supplied;
5. match only that normalized value, for example `1.5+`; and
6. apply the existing reviewed filter confirmation control.

The section lookup must return exactly one matching semantic reference. Zero matches, duplicate
matches inside one section, a missing section boundary, or a numeric control outside the required
section returns `manual_action_required` with `layout_changed`. Existing long-form controls such as
`2 Bedrooms` and `1 Bathrooms` remain supported.

A sanitized diagnostic may record only whitelisted room-control roles, accessible names, ordering,
occurrence counts, and a snapshot hash. It may not retain raw snapshots, URLs, listing content,
cookies, credentials, references, selectors, or unrelated-tab data. Temporary remote diagnostics
are removed immediately after use.

## Preserved boundaries

This repair changes no tool input or output schema, hostname/path allowlist, action allowlist,
navigation behavior, run limit, consent check, policy check, cancellation check, provenance model,
or Vera ingestion behavior. It adds no generic browser surface and cannot activate Contact, Apply,
Tour, Message, Phone, Email, payment, upload, download, login, or CAPTCHA controls.

The accepted Milestone 13A image remains immutable. Candidate 5 also remains immutable. A sixth
candidate may be published only once, after the focused PR and hosted CI are green, under the
founder's explicit authorization for this design.

## Verification

Focused tests will include a sanitized Beds/Baths fixture containing duplicate bare values across
the bedroom and bathroom sections. Tests must prove that the exact bedroom reference and exact
bathroom reference are selected, while unscoped, duplicate, missing-section, and mismatched-value
controls fail closed. Existing long-form behavior must remain green.

The affected Gateway unit, contract, policy, forbidden-action, consent-tab, restart, route
isolation, runtime identity, and zero-vulnerability gates must pass. After green hosted CI, the one
sixth immutable candidate will be signed and verified for SBOM, provenance, digest, and zero
HIGH/CRITICAL findings, then deployed to the existing disposable acceptance Gateway. Restart will
revoke the previous tab share, so the founder must explicitly share exactly one Zillow rental tab
again before the final Boston run.
