# Zillow Browser-Control Timeout Design

## Problem

The bounded Zillow tool repeatedly fails closed while applying the final reviewed rental filter.
Live measurements show Zillow's semantic snapshot/action cycle can take about eight seconds, while
the adapter currently aborts every browser-control request after five seconds. The 90-second whole
run bound and all policy checks are otherwise working as designed.

## Considered approaches

1. **Raise only the per-request browser-control timeout to 15 seconds (selected).** This covers the
   observed latency while the existing remaining-run calculation still caps every request by the
   90-second run deadline.
2. Retry timed-out actions. Rejected because a response can be lost after an action succeeds, and a
   retry could duplicate the action.
3. Manually complete the filter click outside the tool. Rejected because it would bypass the
   Vera-owned bounded action and audit boundary.

## Design

Change `REQUEST_TIMEOUT_MS` from 5,000 to 15,000 milliseconds. Preserve the existing
`remainingRequestTimeout` calculation, so no request can extend the overall 90-second run. Pass the
same reviewed timeout to semantic snapshots. Add a contract assertion that every snapshot request
uses the new value.

No input/output schema, action type, retry policy, hostname, URL, selector, pairing, consent-tab,
route, UID/GID, result/detail cap, or forbidden-action behavior changes.

## Verification

Run the focused Zillow unit, policy, and restart suites; browser/Gateway boundary verifiers; lint,
typecheck, and formatting. After green hosted CI, publish one new immutable candidate, verify its
signature, SBOM, provenance, and zero HIGH/CRITICAL scan, then rerun the disposable Boston live
acceptance.
