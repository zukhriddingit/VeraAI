# Zillow Stale Apply Reference Retry Design

## Problem

Candidate 16 applies every saved Boston criterion, then fails closed when Zillow rerenders the
reviewed result-count apply button between the final semantic snapshot and activation. Two live runs
ended at the same unrecorded action, while a marker-only snapshot immediately afterward showed the
exact reviewed apply button still present.

## Considered approaches

1. **Retry once only after an exact stale-reference response (selected).** Validate the browser
   control response as HTTP 503 with the exact internal `stale semantic reference` error, take a new
   snapshot, require a changed reviewed apply reference, and click it once.
2. Retry every failed action. Rejected because timeouts and lost responses are ambiguous and could
   duplicate a successful action.
3. Click the control manually outside the tool. Rejected because that would bypass the Vera-owned
   authorization and audit boundary.

## Design

`browserPost` will distinguish only the exact bounded stale-reference response from all other
browser action failures. `applyRoomFiltersAndObserve` may recover from that error once by taking a
new snapshot, locating the same reviewed `Done`, `Save`, or `See <count> rentals available` class,
requiring a new semantic reference, and routing the retry through `activateControl`. That path
rechecks founder authorization, policy, kill switch, cancellation, exact tab, hostname, and limits.

Network errors, timeouts, malformed responses, unknown error bodies, unchanged references, and a
second stale response fail closed. The existing no-repeat treatment for ambiguous lost responses is
unchanged.

No new action kind, URL, hostname, selector, JavaScript, credential, schema, result/detail cap,
pairing, consent-tab, route, UID/GID, or forbidden control is introduced.

## Verification

Add tests for one successful fresh-reference retry, a second stale failure, and an unrecognized 503
that remains non-retryable. Run the focused and full unit suites, lint, typecheck, formatting, and all
13A/Gateway source gates. Publish a new immutable candidate only from a green merged SHA, then rerun
the disposable WSS and real Boston ingestion acceptance.
