import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_DEPLOYMENT_DOCUMENTS = [
  "docs/RELEASE_READINESS.md",
  "docs/SECURITY_REVIEW.md",
  "docs/ARCHITECTURE.md",
  "docs/POSTGRES_OPERATIONS.md",
  "docs/GOOGLE_INTEGRATION_SETUP.md",
  "docs/FOUNDER_STAGING_EVIDENCE.md",
  "infra/maritime/README.md",
  "infra/maritime/OPENCLAW.md"
] as const;

const DIGEST_REFERENCE = /@sha256:(?:[a-f0-9]{64}|<[a-z0-9-]+>)/u;
const MUTABLE_DEPLOYMENT_REFERENCE = /(?:^|\s)(?:latest|main|master|[A-Za-z0-9._-]+)(?:\s|$)/u;

export function findReleaseDocumentationViolations(
  documents: Readonly<Record<(typeof RELEASE_DEPLOYMENT_DOCUMENTS)[number], string>>
): string[] {
  const violations: string[] = [];
  for (const [path, document] of Object.entries(documents)) {
    const lines = document.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (!/\bmaritime\s+deploy\b/u.test(line)) return;
      const image = /--image\s+(\S+)/u.exec(line)?.[1];
      if (!image || !DIGEST_REFERENCE.test(image)) {
        violations.push(`${path}:${index + 1} deployment must use image@sha256:<digest>.`);
        return;
      }
      if (MUTABLE_DEPLOYMENT_REFERENCE.test(image.replace(/@sha256:[^\s]+/u, ""))) {
        violations.push(`${path}:${index + 1} deployment must not use a mutable image tag.`);
      }
    });
  }
  return violations;
}

async function main(): Promise<void> {
  const entries = await Promise.all(
    RELEASE_DEPLOYMENT_DOCUMENTS.map(
      async (path) => [path, await readFile(resolve(path), "utf8")] as const
    )
  );
  const documents = Object.fromEntries(entries) as Record<
    (typeof RELEASE_DEPLOYMENT_DOCUMENTS)[number],
    string
  >;
  const violations = findReleaseDocumentationViolations(documents);
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Release deployment documentation uses immutable image digests only.\n");
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
