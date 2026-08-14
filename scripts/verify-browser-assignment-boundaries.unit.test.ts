import { describe, expect, it } from "vitest";

import {
  findBrowserAssignmentViolations,
  type BrowserAssignmentBoundarySources
} from "./verify-browser-assignment-boundaries.ts";

function clean(): BrowserAssignmentBoundarySources {
  return {
    activeServices: "const assignmentAuthorized = true;",
    dispatchRoutes: [
      "browserGatewayRuntime?.resolveForUser(context.userId); createRentalResearchDependencies();"
    ],
    checkpointRoute: `
      function requireAssignedCheckpoint() { authenticateCheckpoint(); }
      export async function POST() {
        requireAssignedCheckpoint();
        readBoundedJson();
        repositoryProvider.forUser(resolved.userId);
      }
    `,
    assignmentMigration: `CREATE TABLE "browser_gateway_assignments" (
      "id" uuid,
      "secret_reference" text,
      "relay_credential_digest" text,
      "checkpoint_credential_digest" text
);`,
    runtimeResolver: [
      "VERA_BETA_ACCESS_GATE_ENABLED",
      "VERA_BROWSER_ASSIGNMENT_ROUTING_ENABLED",
      "VERA_BROWSER_ASSIGNMENT_TOKEN_HASH_VERSION",
      "VERA_BROWSER_BETA_USER_IDS",
      "isActiveUser(",
      "getActiveForUser(",
      "userBrowserEnabled",
      'pairingState !== "paired"',
      'capabilityApprovalState !== "approved"',
      "heartbeatExpiresAt",
      "browserProfileControls.get(",
      "listEnabledConnectorIdsForUser(",
      "secretStore.resolve("
    ].join(" "),
    gatewayRuntimeManifest:
      '"gatewayImage":"ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:4bbdb2886d912766a17de7e53b7c3809ed1172822024f22c4adb984c9c170bde"'
  };
}

describe("browser assignment architecture verifier", () => {
  it("accepts exact assignment routing and credential-to-owner checkpoint order", () => {
    expect(findBrowserAssignmentViolations(clean())).toEqual([]);
  });

  it("rejects global Gateway fallback names in active services", () => {
    const sources = clean();
    expect(
      findBrowserAssignmentViolations({
        ...sources,
        activeServices: "process.env.MARITIME_BROWSER_GATEWAY_AGENT_ID"
      })
    ).toContain("Browser services must not select a global Gateway fallback.");
  });

  it("rejects dispatch and checkpoint tenant selection before assignment authentication", () => {
    const sources = clean();
    const violations = findBrowserAssignmentViolations({
      ...sources,
      dispatchRoutes: ["createRentalResearchDependencies();"],
      checkpointRoute: `
        function requireAssignedCheckpoint() { authenticateCheckpoint(); }
        export async function POST() {
          repositoryProvider.forUser(resolved.userId);
          readBoundedJson();
          requireAssignedCheckpoint();
        }
      `
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        "Browser dispatch must resolve the authenticated user's assignment first.",
        "Checkpoint owner must resolve before body parsing and tenant repositories."
      ])
    );
  });

  it("rejects raw secret columns and mutable or unaccepted Gateway images", () => {
    const sources = clean();
    const violations = findBrowserAssignmentViolations({
      ...sources,
      assignmentMigration: `CREATE TABLE "browser_gateway_assignments" (
        "id" uuid,
        "api_key" text
);`,
      gatewayRuntimeManifest: '"gatewayImage":"example.test/vera:latest"'
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        "Browser assignment persistence must not contain raw secret columns.",
        "Browser beta runtime must pin the accepted immutable Gateway digest.",
        "Browser beta runtime must not use a mutable Gateway image tag."
      ])
    );
  });
});
