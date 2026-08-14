import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserBetaEvidenceLedgerSchema, BrowserBetaSessionEvidenceSchema } from "@vera/domain";

export { BrowserBetaEvidenceLedgerSchema, BrowserBetaSessionEvidenceSchema };

export interface BrowserBetaExpansionInput {
  readonly sessions: number;
  readonly distinctNonFounderTesters: number;
  readonly crossUserIncidents: number;
  readonly credentialIncidents: number;
  readonly backgroundExecutionIncidents: number;
  readonly forbiddenActions: number;
  readonly fourSourceFounderRegression: boolean;
  readonly revocationPasses: number;
  readonly incidentFreeDays: number;
}

export interface BrowserBetaExpansionDecision {
  readonly allowed: boolean;
  readonly reasons: readonly string[];
}

export function evaluateBrowserBetaExpansion(
  input: BrowserBetaExpansionInput
): BrowserBetaExpansionDecision {
  const reasons: string[] = [];
  if (input.sessions < 10) reasons.push("completed_sessions");
  if (input.distinctNonFounderTesters < 3) reasons.push("distinct_nonfounder_testers");
  if (input.crossUserIncidents > 0) reasons.push("cross_user_incidents");
  if (input.credentialIncidents > 0) reasons.push("credential_incidents");
  if (input.backgroundExecutionIncidents > 0) reasons.push("background_execution_incidents");
  if (input.forbiddenActions > 0) reasons.push("forbidden_actions");
  if (!input.fourSourceFounderRegression) reasons.push("four_source_founder_regression");
  if (input.revocationPasses < input.distinctNonFounderTesters) {
    reasons.push("revocation_verification");
  }
  if (input.incidentFreeDays < 7) reasons.push("incident_free_days");
  return { allowed: reasons.length === 0, reasons };
}

export function evaluateBrowserBetaLedger(
  rawLedger: unknown
): BrowserBetaExpansionDecision & { readonly metrics: BrowserBetaExpansionInput } {
  const ledger = BrowserBetaEvidenceLedgerSchema.parse(rawLedger);
  const nonfounderUsers = new Set(
    ledger.sessions
      .filter((session) => session.testerRole === "nonfounder")
      .map((session) => session.userId)
  );
  const usersPassingRevocation = new Set(
    [...nonfounderUsers].filter((userId) =>
      ledger.sessions
        .filter((session) => session.userId === userId)
        .every(
          (session) => session.unshareFollowUpState === "passed" && session.unpairState === "passed"
        )
    )
  );
  const metrics: BrowserBetaExpansionInput = {
    sessions: ledger.sessions.length,
    distinctNonFounderTesters: nonfounderUsers.size,
    crossUserIncidents: ledger.sessions.filter(
      (session) => session.crossUserOwnerCheck === "failed"
    ).length,
    credentialIncidents: ledger.sessions.reduce(
      (total, session) => total + session.credentialIncidentCount,
      0
    ),
    backgroundExecutionIncidents: ledger.sessions.reduce(
      (total, session) => total + session.backgroundExecutionIncidentCount,
      0
    ),
    forbiddenActions: ledger.sessions.reduce(
      (total, session) => total + session.forbiddenActionCount,
      0
    ),
    fourSourceFounderRegression: ledger.founderFourSourceRegression,
    revocationPasses: usersPassingRevocation.size,
    incidentFreeDays: ledger.sessions.some(
      (session) => session.incidentSeverity === 1 || session.incidentSeverity === 2
    )
      ? 0
      : ledger.incidentFreeDays
  };
  return { ...evaluateBrowserBetaExpansion(metrics), metrics };
}

function exactLedgerPath(arguments_: readonly string[], command: string) {
  if (arguments_[0] !== command || arguments_.length !== 3 || arguments_[1] !== "--ledger") {
    throw new Error("Invalid browser beta evidence command.");
  }
  return arguments_[2]!;
}

function record(arguments_: readonly string[]): void {
  if (
    arguments_[0] !== "record" ||
    arguments_.length !== 5 ||
    arguments_[1] !== "--ledger" ||
    arguments_[3] !== "--record"
  ) {
    throw new Error("Usage: browser-beta:evidence record --ledger <path> --record <path>");
  }
  const ledgerPath = arguments_[2]!;
  const recordPath = arguments_[4]!;
  const ledger = BrowserBetaEvidenceLedgerSchema.parse(
    JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown
  );
  const session = BrowserBetaSessionEvidenceSchema.parse(
    JSON.parse(readFileSync(recordPath, "utf8")) as unknown
  );
  if (
    ledger.sessions.some(
      (existing) =>
        existing.assignmentId === session.assignmentId &&
        existing.sourceJobId === session.sourceJobId
    )
  ) {
    throw new Error("Browser beta evidence already contains this assignment and source job.");
  }
  const next = BrowserBetaEvidenceLedgerSchema.parse({
    ...ledger,
    sessions: [...ledger.sessions, session]
  });
  const temporary = `${ledgerPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, ledgerPath);
  process.stdout.write(
    `${JSON.stringify({ recorded: true, sessionCount: next.sessions.length })}\n`
  );
}

function evaluate(arguments_: readonly string[]): void {
  const ledgerPath = exactLedgerPath(arguments_, "evaluate");
  const result = evaluateBrowserBetaLedger(JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.allowed) process.exitCode = 1;
}

function main(): void {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "record") record(arguments_);
  else evaluate(arguments_);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch {
    process.stderr.write("Browser beta evidence command failed safely.\n");
    process.exitCode = 1;
  }
}
