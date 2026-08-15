# Chrome Web Store private release

Vera Browser Connector BETA v2.2.0 is prepared for a **Private — trusted testers** release with
deferred publishing. It must not be submitted as Unlisted or Public.

## Prerequisites

1. Merge a green commit and deploy the canonical privacy/support routes.
2. Verify both public URLs return 200 over HTTPS.
3. Complete the `support@verahousing.app` round-trip from `docs/BROWSER_CONNECTOR_SUPPORT.md`.
4. Run `pnpm verify:vera-openclaw-extension` and `pnpm verify:vera-connector-store`.
5. Generate a fresh package under `/private/tmp` and verify its SHA-256 against the adjacent file.

## Dashboard submission

Resolve the Chrome Web Store publisher account before creating a new item. Upload the exact verified
ZIP, copy the checked-in `store/listing.json` fields, choose Productivity, and use:

- Homepage: `https://verahousing.app`
- Privacy: `https://verahousing.app/privacy/browser-connector`
- Support: `https://verahousing.app/support/browser-connector`

Copy the five permission justifications and privacy declarations from the checked-in Store files.
Add only the founder and explicitly approved Google test accounts as trusted testers, select all
regions, enable deferred publishing, and submit for review. Provide only the time-boxed Vera reviewer
account through the dashboard's private reviewer-access field or direct reviewer coordination.
Never provide an enrollment ticket, relay credential, checkpoint credential, or browser secret.

Private evidence may retain the item ID, version, ZIP SHA-256, commit, publisher label, private
visibility, tester count, deferred-publishing state, submission time, and review state. It must not
retain dashboard cookies, credential fields, enrollment tickets, relay credentials, or tester emails.

## Approval and publication

After approval, publish privately and install with one listed tester in a clean Chrome profile.
Verify version 2.2.0 and exactly `debugger`, `tabs`, `tabGroups`, `storage`, and `alarms`. With a fresh
time-boxed Gateway, sign in to Vera and click **Connect this browser**. Prove that connection alone
shares zero tabs, then prepare, share, unshare, and revoke; finish with zero shared tabs, no
established connection, and no local relay credential.

Only then set `VERA_CHROME_STORE_RELEASE_STATUS=published` and the exact Chrome Web Store item URL in
Vercel and Heroku. One-click enrollment requires a new signed, SBOM-attested Gateway image built from
the merged commit because it adds an objectively missing bounded primitive. Keep both previously
accepted Gateway images immutable as rollback artifacts; do not replace either digest in place.

## Rollback

If review rejects the item, leave the release status unset and keep **Join private beta** visible.
When package bytes change, increment the extension version before resubmission. If an already
published version is unsafe, unpublish it or publish a higher fixed version; never reuse 2.2.0 for
different bytes.
