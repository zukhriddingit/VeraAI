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
  "docs/FOUNDER_CORE_STAGING_RUNBOOK.md",
  "infra/maritime/README.md",
  "infra/maritime/OPENCLAW.md",
  "infra/maritime/ENVIRONMENT.md",
  "infra/maritime/TOPOLOGY.md",
  "infra/maritime/COSTS.md"
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

export function findFounderCoreRunbookViolations(document: string): string[] {
  const violations: string[] = [];
  const required = [
    "founder_core",
    "VERA_BROWSER_DISABLED=1",
    "release-evidence/private/",
    "chmod 0700",
    "chmod 0600",
    "gh workflow run release-worker.yml",
    "conditional_go_founder_only_staging",
    "go_founder_only_core_beta",
    "https://vera-ai-housing.vercel.app"
  ] as const;
  for (const phrase of required) {
    if (!document.includes(phrase)) {
      violations.push(`Founder-core runbook must include ${phrase}.`);
    }
  }
  if (!/landing page[\s\S]{0,160}not[\s\S]{0,80}staging evidence/iu.test(document)) {
    violations.push(
      "Founder-core runbook must state that the deployed landing page is not staging evidence."
    );
  }
  if (
    !/ADR 0012[\s\S]{0,160}founder_browser_experimental[\s\S]{0,80}(?:no_go|blocked)/iu.test(
      document
    )
  ) {
    violations.push(
      "Founder-core runbook must scope the unresolved ingress ADR to browser experimental."
    );
  }
  if (/\b(?:allow|deploy|start|expose) (?:a )?public OpenClaw gateway\b/iu.test(document)) {
    violations.push("Founder-core runbook must not permit a public OpenClaw gateway.");
  }
  if (/\blanding page (?:is|counts as) [^\n]*staging evidence\b/iu.test(document)) {
    violations.push("Founder-core runbook must not treat the landing page as staging evidence.");
  }
  if (/\bADR 0012 (?:blocks|prevents)[^\n]*founder_core\b/iu.test(document)) {
    violations.push("Founder-core runbook must not make ADR 0012 a founder-core blocker.");
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
  const violations = [
    ...findReleaseDocumentationViolations(documents),
    ...findFounderCoreRunbookViolations(documents["docs/FOUNDER_CORE_STAGING_RUNBOOK.md"])
  ];
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    "Release documentation preserves immutable images and the founder-core browser-disabled boundary.\n"
  );
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) await main();
