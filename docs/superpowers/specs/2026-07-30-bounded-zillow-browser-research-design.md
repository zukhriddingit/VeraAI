# Bounded Founder Zillow Browser Research Design

Status: founder-approved Milestone 13B design  
Date: 2026-07-30  
Release profile: `founder_browser_experimental`

## Goal

Add the first real browser-research vertical slice:

```text
saved Vera search profile
  → explicit RentCast and/or Zillow selection
  → one explicitly shared Zillow rental tab
  → bounded Vera-owned research
  → RawListing
  → normalization and provenance
  → cross-source deduplication
  → deterministic ranking and risk
  → Vera inbox
```

The accepted Milestone 13A image remains immutable as the rollback artifact. Milestone 13B
publishes one new immutable candidate only after focused tests and existing release gates pass.

## Chosen boundary

The Gateway exposes one additional model-visible tool:

```text
vera_zillow_rental_research_v1
```

The tool is Vera-owned and performs the whole bounded workflow internally. It does not expose
OpenClaw's generic browser, navigate, act, evaluate, screenshot, download, upload, shell,
filesystem, or generic tool surfaces. Arbitrary JavaScript remains disabled.

The tool accepts a strict versioned object containing only:

- Vera run ID;
- explicit saved-profile location, maximum rent, minimum bedrooms, optional minimum bathrooms,
  and optional rental property type;
- `maxResults`, capped at 10;
- `maxDetailPages`, capped at 5; and
- the approved shared-tab safe reference.

It rejects unknown fields, arbitrary URLs, selectors, coordinates, action sequences, credentials,
cookies, and instructions copied from page content.

## Browser operation contract

The tool may internally:

1. verify exactly one extension-shared tab;
2. require the reviewed Zillow rental hostname and rental surface;
3. detect ready, login, 2FA, CAPTCHA, consent, blocked, and incompatible-layout states;
4. use only semantic snapshot references and observed Zillow link destinations;
5. apply only the supplied profile filters through reviewed controls;
6. navigate the same tab only among the observed Zillow rental results and listing details;
7. perform at most two result-page or scroll expansions;
8. inspect at most 10 result cards and 5 detail pages;
9. return to the observed result page between details; and
10. stop within 90 seconds or immediately on cancellation, revocation, policy denial, or blocker.

Before every browser operation the tool rechecks founder authorization, source policy, browser kill
switch, exact shared tab, allowed hostname, run limits, and cancellation state.

The tool never activates Contact, Apply, Request a tour, Message, Email, Phone, payment, upload,
download, account creation, or login controls. It never solves CAPTCHA or browses in the
background. Forbidden-control detection fails closed.

## Evidence contract

The output is strict JSON containing only observed Zillow evidence:

- source listing ID when visible;
- canonical observed listing URL and final observed detail URL;
- address;
- rent;
- bedrooms;
- bathrooms;
- square footage;
- availability;
- visible amenities;
- observation time;
- field-level source provenance;
- missing fields; and
- safe extraction warnings.

Unknown facts remain `null` or absent according to the schema. The adapter never invents a URL or
fact. Raw snapshots, screenshots, cookies, storage, credentials, unrelated tabs, accessibility
references, selectors, and page instructions are not returned, persisted, or logged.

## Application flow

The saved-profile search launch adds RentCast and Zillow source choices. RentCast remains the
existing `official_api` connector. Zillow is `experimental_personal`, `user_triggered_only`,
founder-only, disabled by default, and never scheduled.

Each selected source has one visible state:

```text
ready | login_required | browser_offline | excluded_by_user | searching |
completed | partial | failed
```

The combined run reports:

```text
connecting → checking login → searching → opening details → importing →
deduplicating → ranking → completed
```

Zillow failure never removes successful RentCast records. Stop cancels unfinished source work and
prevents further browser operations. Retry targets only a failed or manually blocked source.

Validated Zillow records become immutable `RawListing` captures with source URL, observed time, and
bounded structured evidence. They then use the existing normalization jobs and decision
reconciliation so Zillow and RentCast records can join the same duplicate clusters and receive the
same versioned fit scores and risk indicators. OpenClaw research notes remain advisory and separate
from deterministic scoring.

## Manual blockers and revocation

Disconnected extension or Gateway returns `browser_offline`. Zero shared tabs returns
`manual_action_required` with instructions to open and share one Zillow rental tab. Login, 2FA,
CAPTCHA, consent, bot challenge, blocked page, unexpected navigation, or incompatible layout stops
the Zillow source and requests manual action. It does not become an empty success.

Removing the tab from the OpenClaw consent group invalidates the tab reference. The next operation
must stop, return a typed revocation/offline result, create no further RawListing, and preserve
already accepted evidence.

## Audit and privacy

The activity trail records request, source selection, policy decisions, connection checks, safe
progress transitions, blocker or failure codes, bounded counts, RawListing imports, normalization,
deduplication, ranking, cancellation, retry, completion, and revocation. Metadata contains hashes,
IDs, counts, and typed codes only. It contains no raw page snapshot, screenshot, cookie,
credential, contact value, unrelated-tab data, or full page content.

## Verification and release

Focused tests cover:

- strict tool input/output contracts and observed-only fields;
- result, detail, expansion, byte, time, and cancellation limits;
- founder, policy, kill-switch, hostname, one-tab, and per-action rechecks;
- all manual blockers and partial completion;
- forbidden control/action denial;
- RawListing import, normalization, cross-source dedupe, scoring, and presentation;
- source selector, progress, Stop, and failed-source Retry behavior;
- restart and state-link reconciliation;
- preservation of 13A route isolation, pairing, revocation, UID/GID, executable allowlist, and
  security gates; and
- one opt-in live Zillow test.

After green CI, publish and sign exactly one immutable candidate, verify its digest, SBOM,
provenance, and zero HIGH/CRITICAL scan, then use the proven DigitalOcean scripts for one disposable
founder acceptance. The live run must import at least one Boston Zillow rental, prove normalization
and scoring, prove no forbidden action occurred, prove unshare stops work, revoke pairing, and
remove all disposable resources and credentials.

Apartments.com, Facebook Marketplace, Craigslist, outreach, tour scheduling, background polling,
and public-user browser support remain out of scope.
