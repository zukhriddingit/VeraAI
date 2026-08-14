import { describe, expect, it } from "vitest";

import {
  BrowserBetaEvidenceLedgerSchema,
  evaluateBrowserBetaExpansion,
  evaluateBrowserBetaLedger
} from "./browser-beta-evidence.ts";

function expansion(overrides: Partial<Parameters<typeof evaluateBrowserBetaExpansion>[0]> = {}) {
  return {
    sessions: 10,
    distinctNonFounderTesters: 3,
    crossUserIncidents: 0,
    credentialIncidents: 0,
    backgroundExecutionIncidents: 0,
    forbiddenActions: 0,
    fourSourceFounderRegression: true,
    revocationPasses: 3,
    incidentFreeDays: 7,
    ...overrides
  };
}

function session(index: number, userIndex: number) {
  const suffix = String(index).padStart(12, "0");
  const userSuffix = String(userIndex).padStart(12, "0");
  return {
    assignmentId: `10000000-0000-4000-8000-${suffix}`,
    userId: `20000000-0000-4000-8000-${userSuffix}`,
    testerRole: "nonfounder" as const,
    userTriggered: true as const,
    sourceJobId: `job-${String(index)}`,
    source: "zillow" as const,
    startedAt: "2026-08-01T12:00:00.000Z",
    completedAt: "2026-08-01T12:05:00.000Z",
    importedCount: 1,
    checkpointActionTypes: ["verify_shared_tab", "snapshot"] as const,
    forbiddenActionCount: 0,
    unshareFollowUpState: "passed" as const,
    unpairState: "passed" as const,
    crossUserOwnerCheck: "passed" as const,
    credentialIncidentCount: 0,
    backgroundExecutionIncidentCount: 0,
    incidentSeverity: 0
  };
}

describe("browser beta evidence gate", () => {
  it("opens expansion only after every approved threshold", () => {
    expect(evaluateBrowserBetaExpansion(expansion())).toEqual({ allowed: true, reasons: [] });
    expect(evaluateBrowserBetaExpansion(expansion({ fourSourceFounderRegression: false }))).toEqual(
      { allowed: false, reasons: ["four_source_founder_regression"] }
    );
  });

  it.each([
    ["completed_sessions", { sessions: 9 }],
    ["distinct_nonfounder_testers", { distinctNonFounderTesters: 2 }],
    ["cross_user_incidents", { crossUserIncidents: 1 }],
    ["credential_incidents", { credentialIncidents: 1 }],
    ["background_execution_incidents", { backgroundExecutionIncidents: 1 }],
    ["forbidden_actions", { forbiddenActions: 1 }],
    ["revocation_verification", { revocationPasses: 2 }],
    ["incident_free_days", { incidentFreeDays: 6 }]
  ] as const)("blocks on %s", (reason, patch) => {
    expect(evaluateBrowserBetaExpansion(expansion(patch)).reasons).toContain(reason);
  });

  it("derives safe cohort metrics without accepting URLs, credentials, or page content", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session(index + 1, (index % 3) + 1));
    const ledger = {
      version: "1",
      founderFourSourceRegression: true,
      incidentFreeDays: 7,
      sessions
    } as const;
    expect(evaluateBrowserBetaLedger(ledger)).toMatchObject({
      allowed: true,
      metrics: { sessions: 10, distinctNonFounderTesters: 3, revocationPasses: 3 }
    });
    expect(() =>
      BrowserBetaEvidenceLedgerSchema.parse({
        ...ledger,
        sessions: [{ ...sessions[0], listingUrl: "https://example.test/private" }]
      })
    ).toThrow();
    expect(() =>
      BrowserBetaEvidenceLedgerSchema.parse({
        ...ledger,
        sessions: [{ ...sessions[0], checkpointToken: "secret" }]
      })
    ).toThrow();
    expect(
      evaluateBrowserBetaLedger({
        ...ledger,
        sessions: [{ ...sessions[0]!, incidentSeverity: 1 }, ...sessions.slice(1)]
      }).reasons
    ).toContain("incident_free_days");
  });
});
