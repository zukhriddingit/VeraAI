# Chrome Web Store privacy practices

The single purpose is to let an approved Vera beta tester explicitly share one dedicated
housing-search tab with that tester's Vera Browser Gateway for user-triggered, read-only
housing research.

Data types: website content and web browsing activity from exactly the explicitly shared tab. Data
is transferred over secure WSS/HTTPS. Vera does not sell data, use it for advertising or
creditworthiness, or transfer it for unrelated purposes.

The extension creates one random installation identifier in Chrome local storage. The Vera page
receives only its SHA-256 digest. The raw identifier is sent once in the bounded WSS enrollment frame
and transiently digested by Vera's internal checkpoint; it is not persisted or logged. A one-time
enrollment ticket is transient and expires within 60 seconds. After an approved exchange, the
durable relay credential exists only in the assigned Gateway and that Chrome profile. It is never
displayed by Vera. The connection persists across browser restarts until the tester revokes it;
revocation clears the extension credential. Connecting never shares a tab, and full-page screenshots
are not retained as listing photos.

Vera Browser Connector's use and transfer of information received from Chrome APIs adheres to the
Chrome Web Store User Data Policy, including the Limited Use requirements.
