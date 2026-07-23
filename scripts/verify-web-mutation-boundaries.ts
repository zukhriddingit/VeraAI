import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const MUTATION_HANDLERS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTHENTICATION_CALL = /\b(?:requireVeraSession|calendarRouteService)\s*\(/u;
const ORIGIN_CALL = /\bassertSameOriginMutation\s*\(/u;
const BOUNDED_READER_CALL = /\b(?:readBoundedJson|readCalendarMutationJson)\s*\(/u;
const DIRECT_BODY_READER = /\brequest\s*\.\s*(?:json|text|arrayBuffer|blob|formData)\s*\(/u;

export interface MutationBoundaryViolation {
  readonly file: string;
  readonly handler: string;
  readonly line: number;
  readonly message: string;
}

function exported(node: ts.FunctionDeclaration): boolean {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function matchIndex(source: string, expression: RegExp): number | null {
  const match = expression.exec(source);
  return match?.index ?? null;
}

export function findMutationBoundaryViolations(
  files: ReadonlyMap<string, string>
): readonly MutationBoundaryViolation[] {
  const violations: MutationBoundaryViolation[] = [];
  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    for (const statement of sourceFile.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        !exported(statement) ||
        statement.name === undefined ||
        statement.body === undefined ||
        !MUTATION_HANDLERS.has(statement.name.text)
      ) {
        continue;
      }

      const handler = statement.name.text;
      const line =
        sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      const body = statement.body.getText(sourceFile);
      const authentication = matchIndex(body, AUTHENTICATION_CALL);
      const origin = matchIndex(body, ORIGIN_CALL);
      const boundedReader = matchIndex(body, BOUNDED_READER_CALL);

      const report = (message: string): void => {
        violations.push({ file, handler, line, message });
      };

      if (authentication === null) report("mutation route must authenticate");
      if (origin === null) report("mutation route must check exact origin");
      if (authentication !== null && origin !== null && authentication > origin) {
        report("mutation route must authenticate before checking origin");
      }
      if (DIRECT_BODY_READER.test(body)) {
        report("mutation route must use a bounded JSON reader");
      }
      if (origin !== null && boundedReader !== null && origin > boundedReader) {
        report("mutation route must check exact origin before reading its body");
      }
    }
  }
  return violations;
}

function collectRouteFiles(rootDirectory: string): ReadonlyMap<string, string> {
  const apiDirectory = resolve(rootDirectory, "apps/web/app/api");
  const files = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name === "route.ts") {
        const file = relative(rootDirectory, absolute).replaceAll("\\", "/");
        files.set(file, readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(apiDirectory);
  return files;
}

function run(): void {
  const rootDirectory = resolve(import.meta.dirname, "..");
  const violations = findMutationBoundaryViolations(collectRouteFiles(rootDirectory));
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.file}:${violation.line} ${violation.handler} — ${violation.message}\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Web mutation boundaries validated.\n");
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) run();
