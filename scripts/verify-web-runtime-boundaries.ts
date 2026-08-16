import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const GUARDED_FILES = [
  "apps/web/lib/server/application.ts",
  "apps/web/lib/server/unconfigured-calendar-application.ts",
  "apps/web/lib/server/google-integration-contracts.ts",
  "apps/web/lib/server/google-integration-runtime.ts"
] as const;
const LAZY_RUNTIME_FILE = "apps/web/lib/server/google-integration-runtime.ts";
const APPROVED_LAZY_IMPORTS = new Set([
  "./calendar-application.ts",
  "./google-integration-oauth.ts",
  "./gmail-integration-oauth.ts"
]);

export interface WebRuntimeBoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly message: string;
}

const DATE_LOCALE_METHODS = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);

function forbidden(specifier: string): boolean {
  return (
    APPROVED_LAZY_IMPORTS.has(specifier) ||
    specifier === "@vera/calendar" ||
    specifier === "googleapis" ||
    specifier.startsWith("googleapis/") ||
    specifier === "google-auth-library" ||
    specifier.startsWith("google-auth-library/")
  );
}

function runtimeImport(statement: ts.ImportDeclaration): boolean {
  if (statement.importClause?.isTypeOnly) return false;
  const bindings = statement.importClause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0) {
    return bindings.elements.some((element) => !element.isTypeOnly);
  }
  return true;
}

function stringArgument(node: ts.CallExpression): string | null {
  const argument = node.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

export function findWebRuntimeBoundaryViolations(
  files: ReadonlyMap<string, string>
): readonly WebRuntimeBoundaryViolation[] {
  const violations: WebRuntimeBoundaryViolation[] = [];

  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const report = (node: ts.Node, specifier: string, message: string): void => {
      violations.push({
        file,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        specifier,
        message
      });
    };

    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        forbidden(node.moduleSpecifier.text) &&
        runtimeImport(node)
      ) {
        report(
          node,
          node.moduleSpecifier.text,
          "guarded web startup module must not statically load Google runtime code"
        );
      }

      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        forbidden(node.moduleSpecifier.text)
      ) {
        report(
          node,
          node.moduleSpecifier.text,
          "guarded web startup module must not runtime-re-export Google code"
        );
      }

      if (ts.isCallExpression(node)) {
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
        if (isDynamicImport || isRequire) {
          const specifier = stringArgument(node);
          if (specifier !== null && forbidden(specifier)) {
            const approved =
              isDynamicImport && file === LAZY_RUNTIME_FILE && APPROVED_LAZY_IMPORTS.has(specifier);
            if (!approved) {
              report(
                node,
                specifier,
                isDynamicImport
                  ? "Google runtime dynamic imports are allowed only in the reviewed lazy loader"
                  : "guarded web startup module must not require Google runtime code"
              );
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return violations;
}

function propertyName(
  node: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | null {
  for (const property of node.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) && property.name.text === name))
    ) {
      return property;
    }
  }
  return null;
}

function intlDateTimeFormat(node: ts.NewExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Intl" &&
    node.expression.name.text === "DateTimeFormat"
  );
}

export function findWebDateRenderingViolations(
  files: ReadonlyMap<string, string>
): readonly WebRuntimeBoundaryViolation[] {
  const violations: WebRuntimeBoundaryViolation[] = [];

  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const report = (node: ts.Node, specifier: string, message: string): void => {
      violations.push({
        file,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        specifier,
        message
      });
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        DATE_LOCALE_METHODS.has(node.expression.name.text)
      ) {
        report(
          node,
          node.expression.name.text,
          "server-rendered app code must use a reviewed deterministic time formatter"
        );
      }
      if (ts.isNewExpression(node) && intlDateTimeFormat(node)) {
        const options = node.arguments?.[1];
        if (
          !options ||
          !ts.isObjectLiteralExpression(options) ||
          !propertyName(options, "timeZone")
        ) {
          report(
            node,
            "Intl.DateTimeFormat",
            "server-rendered Intl.DateTimeFormat requires an explicit timeZone"
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return violations;
}

function guardedSources(rootDirectory: string): ReadonlyMap<string, string> {
  return new Map(
    GUARDED_FILES.map((file) => [file, readFileSync(resolve(rootDirectory, file), "utf8")])
  );
}

function appSources(rootDirectory: string): ReadonlyMap<string, string> {
  const appDirectory = resolve(rootDirectory, "apps/web/app");
  const files = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        const relative = absolute.slice(rootDirectory.length + 1);
        files.set(relative, readFileSync(absolute, "utf8"));
      }
    }
  };
  visit(appDirectory);
  return files;
}

function run(): void {
  const rootDirectory = resolve(import.meta.dirname, "..");
  const violations = [
    ...findWebRuntimeBoundaryViolations(guardedSources(rootDirectory)),
    ...findWebDateRenderingViolations(appSources(rootDirectory))
  ];
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.file}:${violation.line} ${violation.specifier} — ${violation.message}\n`
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Web runtime boundaries validated.\n");
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && resolve(entryPoint) === fileURLToPath(import.meta.url)) run();
