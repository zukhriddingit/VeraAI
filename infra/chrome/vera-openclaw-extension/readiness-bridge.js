/* global chrome */

// This bridge publishes only sanitized connector readiness to Vera pages. It
// never receives page content, credentials, source URLs, or browser actions.

const RESULT_STATES = new Set([
  "connecting",
  "connected",
  "expired",
  "denied",
  "unavailable",
  "version_incompatible"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isConnectMessage(value) {
  return (
    exactKeys(value, [
      "source",
      "type",
      "version",
      "requestId",
      "confirmation",
      "ticket",
      "expiresAt",
      "gatewayOrigin",
      "protocolVersion"
    ]) &&
    value.source === "vera-web" &&
    value.type === "connect-browser" &&
    value.version === "1" &&
    typeof value.requestId === "string" &&
    UUID_PATTERN.test(value.requestId) &&
    value.confirmation === "connect_read_only_browser"
  );
}

function isClearMessage(value) {
  return (
    exactKeys(value, ["source", "type", "version", "requestId"]) &&
    value.source === "vera-web" &&
    value.type === "clear-browser-connection" &&
    value.version === "1" &&
    typeof value.requestId === "string" &&
    UUID_PATTERN.test(value.requestId)
  );
}

function postEnrollmentResult(requestId, state) {
  const safeState = RESULT_STATES.has(state) ? state : "unavailable";
  window.postMessage(
    {
      source: "vera-openclaw-extension",
      type: "enrollment-result",
      version: "1",
      requestId,
      state: safeState
    },
    window.location.origin
  );
}

async function publishReadiness() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "getStatus" });
    window.postMessage(
      {
        source: "vera-openclaw-extension",
        type: "readiness",
        version: "2",
        paired: status.paired === true,
        relayState: status.state,
        readiness: status.readiness,
        sharedTabCount: status.sharedTabCount,
        extensionVersion: status.extensionVersion,
        enrollmentProtocolVersion: status.enrollmentProtocolVersion,
        installationDigest: status.installationDigest
      },
      window.location.origin
    );
  } catch {
    // Extension reloads are represented by the app's bounded stale timeout.
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (isConnectMessage(event.data)) {
    void (async () => {
      postEnrollmentResult(event.data.requestId, "connecting");
      try {
        const result = await chrome.runtime.sendMessage({
          type: "enroll",
          request: event.data
        });
        postEnrollmentResult(event.data.requestId, result?.state);
        if (result?.state === "connected") await publishReadiness();
      } catch {
        postEnrollmentResult(event.data.requestId, "unavailable");
      }
    })();
    return;
  }
  if (isClearMessage(event.data)) {
    void chrome.runtime.sendMessage({ type: "unpair" }).then(() => publishReadiness());
  }
});

void publishReadiness();
setInterval(() => void publishReadiness(), 1_000);
