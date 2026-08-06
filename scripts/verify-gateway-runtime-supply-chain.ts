import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The lock validator is plain ESM because the same source runs in the image build.
// @ts-expect-error The runtime module intentionally has no generated declaration file.
import { findRuntimeLockViolations } from "../infra/maritime/openclaw/sanitize-runtime-dependencies.mjs";

const OPENCLAW_IMAGE =
  "ghcr.io/openclaw/openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c";
const RUNTIME_IMAGE =
  "cgr.dev/chainguard/node@sha256:942c2eee772885f64808bf0fed5e5f842eafe4d6fe7f602b7dba0f26b6eb1b22";
const FINAL_STAGE = `FROM ${RUNTIME_IMAGE} AS final`;
const FIXED_ENTRYPOINT =
  'ENTRYPOINT ["/usr/bin/node", "/opt/vera/bin/remote-extension-supervisor.mjs"]';
const PROVIDER_BOOTSTRAP_DIRECTORY = "WORKDIR /usr/local/bin";
const APPLICATION_WORKDIR = "WORKDIR /app";
const CONSTRAINED_PATH = "PATH=/usr/bin";
const SYSTEM_SBIN_OPERATIONS = Object.freeze([
  "fs.rmSync('/sbin',{force:true}); ",
  "fs.rmSync('/usr/sbin',{force:true}); ",
  "fs.mkdirSync('/usr/sbin',{mode:0o755}); ",
  "fs.chownSync('/usr/sbin',0,0); ",
  "fs.chmodSync('/usr/sbin',0o755); ",
  "fs.symlinkSync('usr/sbin','/sbin'); "
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function requireText(
  source: string,
  expected: string,
  message: string,
  violations: string[]
): void {
  if (!source.includes(expected)) violations.push(message);
}

export function findGatewayRuntimeSupplyChainViolations(input: {
  readonly dockerfile: string;
  readonly runtimeLock: unknown;
  readonly candidateManifest: unknown;
}): string[] {
  const violations: string[] = [];
  const { dockerfile, runtimeLock, candidateManifest } = input;
  const lockViolations = findRuntimeLockViolations(runtimeLock) as string[];
  violations.push(
    ...lockViolations.map((violation) => `Gateway runtime lock is invalid: ${violation}`)
  );

  const immutableStageMessage =
    "Gateway runtime Dockerfile must use the immutable three-stage transplant.";
  for (const required of [
    `FROM ${OPENCLAW_IMAGE} AS openclaw-runtime`,
    "COPY --chown=root:root --chmod=0444 remote-extension-runtime-lock.json",
    "COPY --chown=root:root --chmod=0555 sanitize-runtime-dependencies.mjs",
    "RUN node /opt/vera-build/sanitize-runtime-dependencies.mjs",
    "FROM openclaw-runtime AS vera-layout",
    FINAL_STAGE
  ]) {
    requireText(dockerfile, required, immutableStageMessage, violations);
  }
  const fromLines = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?$/gimu)];
  if (
    fromLines.length !== 3 ||
    fromLines[0]?.[1] !== OPENCLAW_IMAGE ||
    fromLines[1]?.[1] !== "openclaw-runtime" ||
    fromLines[2]?.[1] !== RUNTIME_IMAGE
  ) {
    violations.push(immutableStageMessage);
  }

  const finalMarkers = dockerfile.split(FINAL_STAGE);
  const finalStage = finalMarkers.length === 2 ? (finalMarkers[1] ?? "") : "";
  const finalBoundaryMessage =
    "Final Gateway runtime must contain only the sanitized application and fixed Vera layout.";
  for (const required of [
    'org.opencontainers.image.revision="${VERA_SOURCE_COMMIT}"',
    `org.opencontainers.image.base.digest="sha256:${RUNTIME_IMAGE.split("@sha256:")[1]}"`,
    `io.vera.openclaw.image.digest="sha256:${OPENCLAW_IMAGE.split("@sha256:")[1]}"`,
    "COPY --from=openclaw-runtime --chown=1000:1000 /app /app",
    "COPY --from=vera-layout --chown=1000:1000 /opt/vera /opt/vera",
    "COPY --from=vera-layout --chown=1000:1000 /data /data",
    PROVIDER_BOOTSTRAP_DIRECTORY,
    APPLICATION_WORKDIR,
    CONSTRAINED_PATH,
    "OPENCLAW_STATE_DIR=/data/.openclaw",
    "USER 1000:1000",
    FIXED_ENTRYPOINT
  ]) {
    requireText(finalStage, required, finalBoundaryMessage, violations);
  }
  const runLines = finalStage.match(/^\s*RUN\b.*$/gmu) ?? [];
  const hasExactToolPrune =
    runLines.length === 1 &&
    runLines[0]?.includes('RUN ["/usr/bin/node", "-e"') === true &&
    runLines[0]?.includes("fs.readdirSync('/usr/bin')") === true &&
    runLines[0]?.includes("name !== 'node'") === true &&
    runLines[0]?.includes("fs.rmSync('/usr/lib/node_modules',{recursive:true,force:true})") ===
      true;
  const providerLayoutPattern =
    /USER 0:0\s+WORKDIR \/usr\/local\/bin\s+WORKDIR \/app[\s\S]*ENV PATH=\/usr\/bin\b/u;
  const providerLayoutViolation =
    !providerLayoutPattern.test(finalStage) ||
    /(?:COPY|ADD|RUN)[^\n]*\/usr\/local\/bin/iu.test(finalStage);
  if (providerLayoutViolation) {
    violations.push(
      "Final Gateway runtime must create one empty provider bootstrap directory through root-owned Docker metadata and exclude it from PATH."
    );
  }
  const systemSbinOperationIndexes = SYSTEM_SBIN_OPERATIONS.map((operation) =>
    runLines[0]?.indexOf(operation)
  );
  const hasOrderedSystemSbinNormalization =
    systemSbinOperationIndexes.every((index) => typeof index === "number" && index >= 0) &&
    systemSbinOperationIndexes.every(
      (index, position) =>
        position === 0 ||
        (index ?? -1) > (systemSbinOperationIndexes[position - 1] ?? Number.MAX_SAFE_INTEGER)
    );
  if (
    !hasOrderedSystemSbinNormalization ||
    /(?:COPY|ADD)[^\n]*(?:\/sbin|\/usr\/sbin)/iu.test(finalStage) ||
    finalStage.includes("maritime-init")
  ) {
    violations.push(
      "Final Gateway runtime must preserve Maritime's empty provider-init filesystem boundary without embedding a provider helper."
    );
  }
  if (
    finalMarkers.length !== 2 ||
    !hasExactToolPrune ||
    /\b(?:npm|pnpm|corepack|apt|apk)\b/iu.test(finalStage) ||
    /(?:^|\s)\/bin\/sh(?:\s|$|["'])/mu.test(finalStage) ||
    /COPY\s+--from=(?:openclaw-runtime|vera-layout)[^\n]*(?:\/usr\/local|\/bin|\/usr\/bin)/iu.test(
      finalStage
    ) ||
    /COPY\s+--from=(?:openclaw-runtime|vera-layout)\s+\/\s+\//iu.test(finalStage) ||
    !/USER 0:0[\s\S]*USER 1000:1000[\s\S]*ENTRYPOINT/u.test(finalStage)
  ) {
    violations.push(finalBoundaryMessage);
  }

  const manifest = object(candidateManifest);
  if (
    manifest === null ||
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(
        [
          "schemaVersion",
          "openclawVersion",
          "baseImage",
          "runtimeBaseImage",
          "runtimeLock",
          "publicationState",
          "image",
          "replacesReleaseIndex",
          "reasonCode",
          "releaseProfile",
          "synthetic",
          "deployableBeforeLiveProxyAcceptance"
        ].sort()
      ) ||
    manifest.schemaVersion !== "1" ||
    manifest?.openclawVersion !== "2026.7.1" ||
    manifest.baseImage !== OPENCLAW_IMAGE ||
    manifest.runtimeBaseImage !== RUNTIME_IMAGE ||
    manifest.runtimeLock !== "infra/maritime/openclaw/remote-extension-runtime-lock.json" ||
    manifest.publicationState !== "pending_security_replacement" ||
    manifest.image !== null ||
    manifest.replacesReleaseIndex !==
      "ghcr.io/zukhriddingit/vera-openclaw-gateway@sha256:be4145e41c8ff28152d1442e987503e0b3afef7dfa3a358e4651c1ddaae5982a" ||
    manifest.reasonCode !== "base_package_cve_2026_69152_69192" ||
    manifest.releaseProfile !== "founder_browser_experimental" ||
    manifest.synthetic !== false ||
    manifest.deployableBeforeLiveProxyAcceptance !== false
  ) {
    violations.push(
      "Gateway candidate manifest must bind the reviewed source and final runtime digests without claiming publication."
    );
  }

  return [...new Set(violations)];
}

export function verifyGatewayRuntimeSupplyChain(root = resolve(import.meta.dirname, "..")): void {
  const directory = resolve(root, "infra/maritime/openclaw");
  const violations = findGatewayRuntimeSupplyChainViolations({
    dockerfile: readFileSync(resolve(directory, "remote-extension.Dockerfile"), "utf8"),
    runtimeLock: JSON.parse(
      readFileSync(resolve(directory, "remote-extension-runtime-lock.json"), "utf8")
    ) as unknown,
    candidateManifest: JSON.parse(
      readFileSync(resolve(directory, "remote-extension-candidate.json"), "utf8")
    ) as unknown
  });
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(resolve(invokedPath)).href === import.meta.url) {
  verifyGatewayRuntimeSupplyChain();
  process.stdout.write("Gateway runtime supply-chain boundaries verified.\n");
}
