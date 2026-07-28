# Search Composer Design

## Objective

Replace the hosted cockpit's fixed seeded-profile experience with a founder-safe search composer that accepts plain-language housing criteria, produces a strict editable draft, saves an immutable search-profile version, and runs the existing RentCast plus Maritime path only after separate explicit confirmation.

This change preserves the current live-search implementation. It does not add browser discovery, broaden source policy, send messages, or make an LLM authoritative for hard constraints.

## User flow

1. The authenticated founder sees a primary prompt labeled "Tell Vera what you're looking for" and a secondary "Enter filters manually" action.
2. Submitting a description calls an authenticated, same-origin interpretation endpoint.
3. The model receives only the entered description, has no tools, and returns a strict allowlisted draft.
4. Vera displays every interpreted value in editable controls. Unknown values remain empty and ambiguities remain visible.
5. "Save profile" validates and persists the reviewed values. It does not call RentCast or Maritime.
6. The new profile becomes the selected active profile.
7. The founder separately acknowledges external API usage and presses "Search now".
8. The existing `/api/live-search` route runs unchanged against the selected saved profile.

If AI interpretation is unavailable, the manual editor opens with the original description retained. The user can still create a valid profile without an LLM.

## Boundaries

- Authentication and same-origin mutation checks apply to interpretation and profile creation.
- Description input is bounded to 2,000 UTF-8 bytes and is never written to a search profile or activity metadata.
- The interpretation provider has no tools, uses `store: false`, and returns a Zod-validated strict object.
- AI output is an unsaved draft. It cannot persist data or trigger live search.
- Location must be either a five-digit US ZIP code or `City, ST`. This matches the existing RentCast query builder without adding a geocoder.
- Budgets, bedrooms, bathrooms, dates, and pet requirements are validated again when the profile is saved.
- Only an allowlisted amenity set can become weighted preferences.
- A reviewed profile is immutable. Editing an existing profile creates the next version with the same logical name.
- Profile persistence and its audit event happen in one repository transaction.
- The audit event contains IDs, version, and a canonical payload hash. It does not contain the natural-language description, commute text, or other free-form private criteria.
- Live search continues to require its existing explicit external-capacity confirmation.
- Existing `founder_core` and browser-enabled release gates are unchanged.

## Domain model

`SearchIntentDraftSchema` is the only structured interpretation output:

- `schemaVersion: "1"`
- `profileName`
- `locationText`
- `targetMonthlyBudgetDollars`
- `maximumMonthlyBudgetDollars`
- `minimumBedrooms`
- `minimumBathrooms`
- `moveInEarliest`
- `moveInLatest`
- `pets`
- `commuteAnchors`
- `amenities`
- `ambiguities`

Every property is explicit. Unknown scalar values are `null`; unknown collections are empty. Arbitrary metadata and extra fields are rejected.

Amenity codes are limited to:

- `laundry_in_unit`
- `laundry_in_building`
- `parking`
- `dishwasher`
- `air_conditioning`
- `elevator`
- `outdoor_space`

An amenity may be marked required or preferred. Required amenities become deterministic `contains` hard constraints with `unknownPolicy: "reject"`. Preferred amenities become weighted preferences with stable weights. No free-form model-generated field or operator enters the policy engine.

## Provider boundary

`SearchIntentProvider` is separate from listing extraction:

```ts
interface SearchIntentProvider {
  readonly providerId: string;
  readonly model: string;
  interpret(
    request: SearchIntentInterpretRequest,
    options: LLMProviderOptions
  ): Promise<SearchIntentDraft>;
}
```

The OpenAI implementation uses the existing Responses API dependency, strict Zod parsing, a bounded timeout, no tools, no storage, no browsing, and one repair attempt for invalid structured output. Provider-specific errors are mapped to safe application codes. The UI never displays provider response bodies or credentials.

## API contracts

### `POST /api/search-profiles/interpret`

Request:

```json
{ "description": "One bedroom in Boston under $2,900..." }
```

Success:

```json
{ "draft": { "schemaVersion": "1" } }
```

Safe errors:

- `unauthorized`
- `cross_origin_request`
- `malformed_request`
- `interpretation_unavailable`
- `interpretation_invalid`

### `POST /api/search-profiles`

The request contains a reviewed `draft` and optional `basedOnProfileId`. The service converts dollar integers to cents, enforces field relationships, creates the profile and activity event atomically, and returns `{ "profile": SearchProfile }`.

Safe errors:

- `unauthorized`
- `cross_origin_request`
- `malformed_request`
- `profile_conflict`
- `profile_unavailable`

## Interface design

The composer replaces the current single-purpose live-search card with three visually connected states:

1. **Describe**: a large text area with example copy and a clear manual fallback.
2. **Review**: a responsive two-column editor with labels above every control, inline validation, explicit unknown fields, and an ambiguity notice.
3. **Search**: the selected saved profile summary, external-capacity acknowledgment, and one "Search now" button.

Existing profiles remain selectable. "Edit as new version" loads the selected profile into the review editor without mutating it. The listing decision cockpit remains directly below the search area.

The redesign preserves Vera's existing forest, mint, coral, paper, and soft-radius tokens. It adds no new dependency, no decorative motion, and no new font. Desktop uses a 5/7 asymmetric composer layout; widths below 768 px collapse to one column. Focus styles, form labels, error text, and button states remain keyboard accessible and high contrast.

## Failure behavior

- Interpretation timeout or provider failure: show a plain safe explanation, retain the description, and open manual entry.
- Invalid model output after repair: same manual fallback; do not persist partial output.
- Save validation failure: keep the editor values and show field-level or form-level errors.
- Profile version conflict: reload the profile list and ask the user to save again; do not overwrite.
- Live-search failure: preserve the existing status and one-retry behavior.
- Any unauthenticated or cross-origin request: fail before provider or database access.

## Test strategy

- Domain unit tests reject extra fields, invalid location shapes, invalid ranges, unallowlisted amenities, and target budget above maximum.
- AI unit tests prove strict request parsing, tool-free non-stored calls, valid output, one repair, and safe failure.
- Service unit tests prove profile conversion, deterministic hard constraints, immutable versioning, atomic audit, and absence of raw descriptions from persistence.
- Route integration tests prove authentication, same-origin enforcement, request bounds, demo-mode denial, successful creation, and safe error mapping.
- Component unit tests cover manual fallback helpers and profile-to-draft mapping.
- Playwright covers describe, edit, save, explicit confirmation, and live-search dispatch using mocked route responses.
- Production build, typecheck, lint, focused unit/integration tests, and a visual browser check are required before merge.

