import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RELEASE_DEPLOYMENT_DOCUMENTS,
  findFounderCoreRunbookViolations,
  findReleaseDocumentationViolations
} from "./verify-release-documentation.ts";

function documents(line: string) {
  return Object.fromEntries(RELEASE_DEPLOYMENT_DOCUMENTS.map((path) => [path, line])) as Record<
    (typeof RELEASE_DEPLOYMENT_DOCUMENTS)[number],
    string
  >;
}

describe("release deployment documentation", () => {
  it("accepts digest-qualified image examples and explicit digest placeholders", () => {
    expect(
      findReleaseDocumentationViolations(
        documents(
          "maritime deploy vera-worker --source docker --image ghcr.io/example/vera-worker@sha256:<candidate-worker-digest> --wait"
        )
      )
    ).toEqual([]);
  });

  it("rejects mutable, branch, and tag-only deployment examples", () => {
    for (const image of [
      "ghcr.io/example/vera-worker:latest",
      "ghcr.io/example/vera-worker:main",
      "ghcr.io/example/vera-worker:reviewed-commit"
    ]) {
      expect(
        findReleaseDocumentationViolations(
          documents(`maritime deploy vera-worker --source docker --image ${image} --wait`)
        )
      ).toEqual(expect.arrayContaining([expect.stringContaining("image@sha256:<digest>")]));
    }
  });
});

describe("founder-core staging runbook", () => {
  const runbook = readFileSync(
    new URL("../docs/FOUNDER_CORE_STAGING_RUNBOOK.md", import.meta.url),
    "utf8"
  );

  it("contains the profile, evidence, artifact, classification, and landing-page boundaries", () => {
    expect(findFounderCoreRunbookViolations(runbook)).toEqual([]);
  });

  it.each([
    [
      "Deploy a public OpenClaw gateway",
      "Founder-core runbook must not permit a public OpenClaw gateway."
    ],
    [
      "The landing page is accepted staging evidence",
      "Founder-core runbook must not treat the landing page as staging evidence."
    ],
    [
      "ADR 0012 blocks founder_core",
      "Founder-core runbook must not make ADR 0012 a founder-core blocker."
    ]
  ])("rejects %s", (unsafe, expected) => {
    expect(findFounderCoreRunbookViolations(`${runbook}\n${unsafe}\n`)).toContain(expected);
  });
});
