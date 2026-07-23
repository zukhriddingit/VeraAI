import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  {
    rule: "forbidden_scope",
    pattern: /https:\/\/www\.googleapis\.com\/auth\/gmail\.(?:compose|modify|send)\b/iu
  },
  { rule: "broad_scope", pattern: /https:\/\/mail\.google\.com\//iu },
  {
    rule: "send_or_draft_operation",
    pattern: /\b(?:drafts\.(?:create|send)|messages\.send)\b/iu
  },
  {
    rule: "send_endpoint",
    pattern: /\/gmail\/v1\/users\/[^/\s"'`]+\/(?:drafts|messages)\/send\b/iu
  }
] as const;

const SKIPPED_DIRECTORIES = new Set([".next", "coverage", "dist", "node_modules"]);

export interface GmailBoundaryViolation {
  readonly file: string;
  readonly rule: (typeof RULES)[number]["rule"];
}

function productionSource(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return (
    /\.(?:ts|tsx)$/u.test(normalized) &&
    !normalized.includes(".test.") &&
    !normalized.includes(".spec.") &&
    !normalized.includes(".test-fixtures.") &&
    !normalized.includes("/test-support/") &&
    !normalized.includes("/__fixtures__/") &&
    !normalized.includes("/__tests__/")
  );
}

export function findGmailBoundaryViolations(
  files: ReadonlyMap<string, string>
): readonly GmailBoundaryViolation[] {
  const violations: GmailBoundaryViolation[] = [];
  for (const [file, source] of files) {
    for (const { rule, pattern } of RULES) {
      if (pattern.test(source)) violations.push({ file, rule });
    }
  }
  return violations;
}

function collectProductionFiles(rootDirectory: string): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(absolute);
      } else if (entry.isFile()) {
        const file = relative(rootDirectory, absolute).replaceAll("\\", "/");
        if (productionSource(file)) files.set(file, readFileSync(absolute, "utf8"));
      }
    }
  };
  for (const directory of ["apps/web", "apps/worker", "packages/connectors"]) {
    visit(resolve(rootDirectory, directory));
  }
  return files;
}

function requiredBoundaryViolations(rootDirectory: string): string[] {
  const failures: string[] = [];
  const domain = readFileSync(resolve(rootDirectory, "packages/domain/src/gmail.ts"), "utf8");
  const client = readFileSync(
    resolve(rootDirectory, "packages/connectors/src/gmail-client.ts"),
    "utf8"
  );
  if (
    !/GMAIL_READONLY_SCOPE\s*=\s*"https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly"/u.test(
      domain
    )
  ) {
    failures.push("packages/domain/src/gmail.ts must define the exact gmail.readonly scope");
  }
  if (!/readonly method:\s*"GET"/u.test(client) || /readonly method:\s*"POST"/u.test(client)) {
    failures.push("packages/connectors/src/gmail-client.ts must expose GET-only transport");
  }
  if (
    /\b(?:createDraft|sendDraft|sendMessage|modifyMessage|deleteMessage|labelMessage)\s*\(/iu.test(
      client
    )
  ) {
    failures.push("packages/connectors/src/gmail-client.ts exposes a forbidden mailbox operation");
  }
  return failures;
}

function run(): void {
  const rootDirectory = resolve(import.meta.dirname, "..");
  const violations = findGmailBoundaryViolations(collectProductionFiles(rootDirectory));
  const requiredFailures = requiredBoundaryViolations(rootDirectory);
  if (violations.length > 0 || requiredFailures.length > 0) {
    for (const violation of violations) {
      process.stderr.write(`${violation.file} — ${violation.rule}\n`);
    }
    for (const failure of requiredFailures) process.stderr.write(`${failure}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Gmail production sources are readonly-only.\n");
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) run();
