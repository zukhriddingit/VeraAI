# ADR 0010: Pinned OpenClaw current-tab capture

- Status: Accepted
- Date: 2026-07-21

Superseded in part by ADR 0011: the current reviewed OpenClaw pin is `2026.6.33`, and Maritime deployment/dispatch assets are now implemented. This record remains authoritative for the exact current-tab, no-navigation, no-side-effect boundary.

## Context

ADR 0007 established Maritime and OpenClaw application-owned boundaries but intentionally provided mocks only. The first live browser path needs to prove the local privacy boundary without turning Vera into a crawler or site-action agent.

## Decision

Implement one source-specific operation: `zillow.current-tab.v1` captures the already-open exact Zillow listing tab selected by an authenticated founder. It is `local_browser`, `experimental_personal`, manual-only, unsupported, disabled by default, and requires explicit user/source activation plus four-part capture confirmation.

The original reviewed pin was `2026.5.28`. ADR 0011 replaces that pin with `2026.6.33` and ships the exact version in the worker image. The real adapter uses the pinned release's native node browser proxy through fixed `openclaw nodes invoke --node <selected> --command browser.proxy --params <json> --idempotency-key <key>` calls. The only proxy requests are `GET /tabs` and `GET /snapshot` for the explicitly selected allowlisted profile. Gateway credentials remain in the server-side child environment. No navigation, discovery, schedule, click, type, evaluate, cookie/storage, upload/download, compose, send, form, apply, payment, contact, account-setting, shell, or filesystem operation is representable.

PostgreSQL owns user/node/profile controls, job/attempt states, immutable acceptance, raw import, normalization enqueue, and audit. The worker claims jobs with `SKIP LOCKED`, rechecks current controls, approval, node health, pairing, capability, profile, and version, invokes the provider outside a transaction, then accepts a matching bounded result atomically. Offline nodes defer visibly. Pairing, capability, login, 2FA, CAPTCHA, consent, challenge, redirects, stale target, layout uncertainty, upload/download, camera/microphone, version mismatch, and policy uncertainty remain typed non-success states.

The deterministic SQLite demo does not compose the real provider and rejects live browser-control/acceptance mutations.

## Consequences

- The founder can dogfood one real listing capture without granting site actions or broad search.
- Listing page content required for capture may traverse the configured gateway and reach hosted Vera; only login/session state remains local.
- OpenClaw upgrades require explicit interface/security review and a pin change.
- A manual founder registration helper synchronizes a separately verified node/profile with a short heartbeat. ADR 0011 adds Maritime deployment assets, dispatch, scheduling, and heartbeat reconciliation; saved-search discovery and additional browser sources remain future work.
- Zillow, Facebook Marketplace, Craigslist, and other consumer-site browser connectors remain disabled for public hosted use.

## Supersession scope

This ADR supersedes ADR 0007 only where it says no real OpenClaw installation, adapter, or local-browser source path exists. ADR 0007's replaceable contract, Maritime boundary, job states, offline behavior, minimum payload, untrusted output, and prohibition on credentials/side effects remain accepted. ADR 0011 separately authorizes the documented Maritime deployment assets; scheduled browser polling remains unauthorized.

## Revisit when

Revisit before changing the OpenClaw version/interface, enrolling users beyond founder dogfooding, adding continuous heartbeat transport, scheduling acquisition, or introducing any navigation or new source capability.
