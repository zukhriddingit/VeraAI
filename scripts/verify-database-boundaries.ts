import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)(["'])([^"']+)\1/gu;

export interface DatabaseBoundaryViolation {
  readonly file: string;
  readonly specifier: string;
}

interface DatabasePackageLike {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

export function findDatabasePackageBoundaryViolations(
  packageJson: DatabasePackageLike
): DatabaseBoundaryViolation[] {
  const violations: DatabaseBoundaryViolation[] = [];
  if (packageJson.dependencies?.["better-sqlite3"] !== undefined) {
    violations.push({
      file: "packages/db/package.json",
      specifier: "production dependency better-sqlite3"
    });
  }
  if (packageJson.devDependencies?.["better-sqlite3"] !== "12.11.1") {
    violations.push({
      file: "packages/db/package.json",
      specifier: "missing exact demo-only better-sqlite3 dev dependency"
    });
  }
  return violations;
}

function productionFile(file: string): boolean {
  return (
    (file.startsWith("apps/web/") || file.startsWith("apps/worker/")) &&
    !file.includes(".test.") &&
    !file.includes("test-support/") &&
    file !== "apps/web/lib/server/demo-application.ts"
  );
}

export function findDatabaseBoundaryViolations(
  files: readonly string[],
  rootDirectory = process.cwd()
): DatabaseBoundaryViolation[] {
  const violations: DatabaseBoundaryViolation[] = [];
  for (const file of files.filter(productionFile)) {
    const source = readFileSync(resolve(rootDirectory, file), "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2]!;
      if (
        specifier === "better-sqlite3" ||
        specifier === "@vera/db/demo" ||
        specifier === "@vera/db/runtime" ||
        /packages\/db\/src\/(?:connection|schema|migrations|sqlite-|demo\/)/u.test(specifier)
      ) {
        violations.push({ file, specifier });
      }
    }
  }
  return violations;
}

function trackedFiles(): string[] {
  const output = execGit(["ls-files", "*.ts", "*.tsx"]);
  return output.split("\n").filter(Boolean);
}

function execGit(args: readonly string[]): string {
  return execFileSync("git", [...args], { encoding: "utf8" });
}

export function verifyDatabaseBoundaries(rootDirectory = process.cwd()): void {
  const violations = findDatabaseBoundaryViolations(trackedFiles(), rootDirectory);
  const rootIndex = readFileSync(resolve(rootDirectory, "packages/db/src/index.ts"), "utf8");
  const databasePackage = JSON.parse(
    readFileSync(resolve(rootDirectory, "packages/db/package.json"), "utf8")
  ) as DatabasePackageLike;
  violations.push(...findDatabasePackageBoundaryViolations(databasePackage));
  for (const forbidden of [
    "./connection.ts",
    "./schema.ts",
    "./migrations.ts",
    "./sqlite-repositories.ts",
    "./seed.ts"
  ]) {
    if (rootIndex.includes(forbidden)) {
      violations.push({ file: "packages/db/src/index.ts", specifier: forbidden });
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Hosted database boundary violations:\n${violations
        .map(({ file, specifier }) => `- ${file}: ${specifier}`)
        .join("\n")}`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  verifyDatabaseBoundaries(resolve(process.cwd()));
  process.stdout.write(`${JSON.stringify({ event: "database_boundaries_verified" })}\n`);
}
