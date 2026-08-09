/* global chrome */

// This bridge publishes only sanitized connector readiness to Vera pages. It
// never receives page content, credentials, source URLs, or browser actions.

async function publishReadiness() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "getStatus" });
    window.postMessage(
      {
        source: "vera-openclaw-extension",
        type: "readiness",
        version: "1",
        paired: status.paired === true,
        relayState: status.state,
        readiness: status.readiness,
        sharedTabCount: status.sharedTabCount
      },
      window.location.origin
    );
  } catch {
    // Extension reloads are represented by the app's bounded stale timeout.
  }
}

void publishReadiness();
setInterval(() => void publishReadiness(), 1_000);
