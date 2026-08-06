import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { findGatewayRuntimeSupplyChainViolations } from "./verify-gateway-runtime-supply-chain.ts";

const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "infra/maritime/openclaw");

function fixture() {
  return {
    dockerfile: readFileSync(resolve(directory, "remote-extension.Dockerfile"), "utf8"),
    runtimeLock: JSON.parse(
      readFileSync(resolve(directory, "remote-extension-runtime-lock.json"), "utf8")
    ) as unknown,
    candidateManifest: JSON.parse(
      readFileSync(resolve(directory, "remote-extension-candidate.json"), "utf8")
    ) as unknown
  };
}

describe("Gateway runtime supply-chain verifier", () => {
  it("accepts the immutable minimal runtime transplant", () => {
    expect(findGatewayRuntimeSupplyChainViolations(fixture())).toEqual([]);
  });

  it.each([
    [
      "mutable Chainguard base",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace(
          "cgr.dev/chainguard/node@sha256:942c2eee772885f64808bf0fed5e5f842eafe4d6fe7f602b7dba0f26b6eb1b22",
          "cgr.dev/chainguard/node:latest"
        );
      }
    ],
    [
      "shell entrypoint",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace(
          'ENTRYPOINT ["/usr/bin/node"',
          'ENTRYPOINT ["/bin/sh"'
        );
      }
    ],
    [
      "wrong identity",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace("USER 1000:1000", "USER 65532");
      }
    ],
    [
      "package manager copied",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile += "\nCOPY --from=openclaw-runtime /usr/local /usr/local\n";
      }
    ],
    [
      "missing sanitizer",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replaceAll("sanitize-runtime-dependencies.mjs", "");
      }
    ],
    [
      "missing final tool prune",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace(
          /^RUN \["\/usr\/bin\/node", "-e", "const fs=.*\n/mu,
          ""
        );
      }
    ],
    [
      "unexpected repair",
      (input: ReturnType<typeof fixture>) => {
        const lock = input.runtimeLock as {
          repairs: Array<Record<string, unknown>>;
        };
        lock.repairs.push({ ...lock.repairs[0], name: "unexpected" });
      }
    ],
    [
      "candidate claiming publication",
      (input: ReturnType<typeof fixture>) => {
        const candidate = input.candidateManifest as Record<string, unknown>;
        candidate.publicationState = "published";
        candidate.image = `ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:${"a".repeat(64)}`;
      }
    ],
    [
      "candidate with arbitrary metadata",
      (input: ReturnType<typeof fixture>) => {
        const candidate = input.candidateManifest as Record<string, unknown>;
        candidate.metadata = "not-allowed";
      }
    ],
    [
      "missing provider bootstrap directory",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace("WORKDIR /usr/local/bin\n", "");
      }
    ],
    [
      "provider bootstrap directory created as runtime user",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace(
          "USER 0:0\nWORKDIR /usr/local/bin",
          "USER 1000:1000\nWORKDIR /usr/local/bin"
        );
      }
    ],
    [
      "provider bootstrap directory added to PATH",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace(
          "PATH=/usr/bin",
          "PATH=/usr/local/bin:/usr/bin"
        );
      }
    ],
    [
      "provider helper copied into immutable image",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile +=
          "\nCOPY --from=vera-layout /opt/provider-helper /usr/local/bin/provider-helper\n";
      }
    ],
    [
      "missing system sbin normalization",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace("fs.rmSync('/sbin',{force:true}); ", "");
      }
    ],
    [
      "missing system administration directory creation",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace("fs.mkdirSync('/usr/sbin',{mode:0o755}); ", "");
      }
    ],
    [
      "wrong system sbin target",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile = input.dockerfile.replace(
          "fs.symlinkSync('usr/sbin','/sbin'); ",
          "fs.symlinkSync('usr/bin','/sbin'); "
        );
      }
    ],
    [
      "provider init copied into immutable image",
      (input: ReturnType<typeof fixture>) => {
        input.dockerfile += "\nCOPY --from=vera-layout /opt/provider-helper /sbin/maritime-init\n";
      }
    ]
  ])("rejects %s", (_label, mutate) => {
    const input = fixture();
    mutate(input);
    expect(findGatewayRuntimeSupplyChainViolations(input)).not.toEqual([]);
  });
});
