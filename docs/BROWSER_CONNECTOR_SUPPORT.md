# Browser Connector support

The public support route is `https://verahousing.app/support/browser-connector` and the dedicated
mailbox is `support@verahousing.app`.

Before Chrome Web Store submission, send one test message to the alias and verify the configured
recipient can reply. Record only success/failure and time in private release evidence. Never retain
message contents, tester email, passwords, cookies, pairing values, browser profiles, raw page
snapshots, or authenticated headers in repository evidence.

Support must preserve the one-tab, user-triggered, read-only boundary. It must never request a
credential or advise bypassing login, 2FA, CAPTCHA, consent, checkpoints, rate limits, or blocking.
