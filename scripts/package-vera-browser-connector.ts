import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CONNECTOR_PACKAGE_ENTRIES = [
  "background.js",
  "images/icon-128.png",
  "images/icon-16.png",
  "images/icon-32.png",
  "images/icon-48.png",
  "manifest.json",
  "modules/enrollment.js",
  "modules/popup-copy.js",
  "modules/prepared-tab.js",
  "modules/relay-core.js",
  "popup.html",
  "popup.js",
  "readiness-bridge.js",
  "release-lock.json"
] as const;

export async function packageVeraBrowserConnector(input: {
  readonly sourceDirectory: string;
  readonly outputDirectory: string;
}): Promise<{
  readonly zipPath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly entries: readonly string[];
}> {
  const staging = await mkdtemp(join(tmpdir(), "vera-browser-connector-"));
  const fixed = new Date("2000-01-01T00:00:00.000Z");
  for (const entry of CONNECTOR_PACKAGE_ENTRIES) {
    const source = resolve(input.sourceDirectory, entry);
    const sourceStat = await stat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
      throw new Error(`Package entry is not a regular file: ${entry}`);
    const target = resolve(staging, entry);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    await utimes(target, fixed, fixed);
  }
  await mkdir(input.outputDirectory, { recursive: true });
  const zipPath = resolve(input.outputDirectory, "vera-browser-connector-2.2.0.zip");
  const zipped = spawnSync("/usr/bin/zip", ["-X", "-q", zipPath, ...CONNECTOR_PACKAGE_ENTRIES], {
    cwd: staging,
    encoding: "utf8",
    shell: false
  });
  if (zipped.status !== 0) throw new Error(`zip failed: ${zipped.stderr.trim()}`);
  const archive = await readFile(zipPath);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  await writeFile(`${zipPath}.sha256`, `${sha256}  ${relative(input.outputDirectory, zipPath)}\n`, {
    mode: 0o600
  });
  return { zipPath, sha256, bytes: archive.byteLength, entries: CONNECTOR_PACKAGE_ENTRIES };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputIndex = process.argv.indexOf("--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (!output)
    throw new Error("Usage: package-vera-browser-connector --output <private-output-directory>");
  const resolved = resolve(output);
  if (!resolved.startsWith("/private/tmp/") && !resolved.includes("/release-evidence/private/")) {
    throw new Error(
      "Connector packages must be written below /private/tmp or release-evidence/private."
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      await packageVeraBrowserConnector({
        sourceDirectory: resolve("infra/chrome/vera-openclaw-extension"),
        outputDirectory: resolved
      }),
      null,
      2
    )}\n`
  );
}
