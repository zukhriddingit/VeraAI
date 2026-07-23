import { describe, expect, it } from "vitest";

import {
  RELEASE_DEPLOYMENT_DOCUMENTS,
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
