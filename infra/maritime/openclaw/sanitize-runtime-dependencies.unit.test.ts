import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// Plain ESM is intentional because this exact source runs during the image build.
// @ts-expect-error The runtime module has no generated declaration file.
import {
  findRuntimeLockViolations,
  retainEnrollmentWebSocketRuntime,
  resolveRepairTarget,
  sanitizeRuntimeDependencies,
  verifyIntegrity,
  verifyPackageManifest
} from "./sanitize-runtime-dependencies.mjs";

interface Repair {
  readonly name: string;
  readonly path: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly tarball: string;
  readonly integrity: string;
  readonly dependencyNames: readonly string[];
}

interface RuntimeLock {
  readonly finalRuntime: {
    readonly imageIndex: string;
    readonly linuxAmd64Image: string;
    readonly observedNodeVersion: string;
    readonly uid: number;
    readonly gid: number;
  };
  readonly repairs: readonly Repair[];
  readonly enrollmentWebSocketRuntime: {
    readonly files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>;
  };
}

const lock = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "remote-extension-runtime-lock.json"), "utf8")
) as RuntimeLock;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function integrity(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

describe("Gateway runtime dependency sanitizer", () => {
  it("accepts only the closed immutable runtime lock", () => {
    expect(findRuntimeLockViolations(lock)).toEqual([]);
    expect(
      findRuntimeLockViolations({
        ...lock,
        finalRuntime: { ...lock.finalRuntime, uid: 65_532 }
      })
    ).toContain("Final Gateway runtime UID/GID must remain 1000:1000.");
    expect(
      findRuntimeLockViolations({
        ...lock,
        repairs: [...lock.repairs, { ...lock.repairs[0], name: "unexpected" }]
      })
    ).toContain("Runtime repair lock must contain exactly the eight approved packages.");
    expect(
      findRuntimeLockViolations({
        ...lock,
        enrollmentWebSocketRuntime: {
          ...lock.enrollmentWebSocketRuntime,
          files: [
            ...lock.enrollmentWebSocketRuntime.files,
            { path: "bin/ws", sha256: "a".repeat(64) }
          ]
        }
      })
    ).toContain("Gateway enrollment WebSocket runtime must match the exact locked ws files.");
    expect(
      findRuntimeLockViolations({
        ...lock,
        allowedFinalExecutables: ["/usr/bin/node", "/bin/sh"]
      })
    ).toContain("Runtime repair lock must allow only the Node executable in the final image.");
  });

  it("pins the fixed Gateway packages disclosed by the current security scan", () => {
    expect(
      lock.repairs
        .filter(({ name }) => ["fast-uri", "ip-address", "undici"].includes(name))
        .map(({ name, fromVersion, toVersion, dependencyNames }) => ({
          name,
          fromVersion,
          toVersion,
          dependencyNames
        }))
    ).toEqual([
      {
        name: "fast-uri",
        fromVersion: "3.1.2",
        toVersion: "3.1.5",
        dependencyNames: []
      },
      {
        name: "ip-address",
        fromVersion: "10.2.0",
        toVersion: "10.3.1",
        dependencyNames: []
      },
      {
        name: "undici",
        fromVersion: "8.5.0",
        toVersion: "8.9.0",
        dependencyNames: []
      },
      {
        name: "undici",
        fromVersion: "7.28.0",
        toVersion: "7.29.0",
        dependencyNames: []
      }
    ]);
  });

  it("rejects a stale runtime base", () => {
    expect(lock.finalRuntime).toMatchObject({
      imageIndex:
        "cgr.dev/chainguard/node@sha256:3a3fbc052438535cca1ac0eed75c2dabf04a7ce7de749667cd265f98dbf9c771",
      linuxAmd64Image:
        "cgr.dev/chainguard/node@sha256:abd1ea54ba68e3b2526c26ad5ef615823121a99010b595f1b4ebab77d47d061d",
      observedNodeVersion: "26.7.0"
    });
    expect(
      findRuntimeLockViolations({
        ...lock,
        finalRuntime: {
          ...lock.finalRuntime,
          imageIndex:
            "cgr.dev/chainguard/node@sha256:cf7ae5ead5aed79a61404d7b1bbb9b89ea461991b21cb8fcb07d4b6ad4d8b734",
          linuxAmd64Image:
            "cgr.dev/chainguard/node@sha256:f077d539a12eee7b7cd0ae1f79b3b779a82e72c93e274983aa0cd0f6519a70c2",
          observedNodeVersion: "26.6.0"
        }
      })
    ).toContain("Gateway runtime lock must pin the reviewed Chainguard amd64 Node image.");
  });

  it("rejects package name, version, and dependency-surface drift", () => {
    const repair = lock.repairs[0];
    if (!repair) throw new Error("Expected a repair fixture.");
    const dependencies = Object.fromEntries(
      repair.dependencyNames.map((name) => [name, "fixture"])
    );
    expect(
      verifyPackageManifest({
        manifest: { name: repair.name, version: repair.fromVersion },
        repair,
        phase: "source"
      })
    ).toEqual([]);
    expect(
      verifyPackageManifest({
        manifest: { name: repair.name, version: repair.toVersion, dependencies },
        repair,
        phase: "replacement"
      })
    ).toEqual([]);
    expect(
      verifyPackageManifest({
        manifest: {
          name: repair.name,
          version: repair.toVersion,
          dependencies: { ...dependencies, unexpected: "1.0.0" }
        },
        repair,
        phase: "replacement"
      })
    ).toContain("Replacement package dependency names do not match the runtime lock.");
  });

  it("verifies the exact sha512 npm integrity", () => {
    const bytes = Buffer.from("synthetic-package-archive", "utf8");
    expect(() => verifyIntegrity(bytes, integrity(bytes))).not.toThrow();
    expect(() => verifyIntegrity(bytes, integrity(Buffer.from("modified")))).toThrow(
      "Runtime repair tarball integrity mismatch."
    );
    expect(() => verifyIntegrity(bytes, "sha256-not-accepted")).toThrow(
      "Only sha512 npm integrity is accepted."
    );
  });

  it("replaces every expected package directory without network access", async () => {
    const appRoot = mkdtempSync(join(tmpdir(), "vera-runtime-sanitizer-"));
    temporaryDirectories.push(appRoot);
    const archives = new Map<string, Uint8Array>();
    const syntheticLock = {
      ...lock,
      repairs: lock.repairs.map((repair) => {
        const bytes = Buffer.from(`archive:${repair.name}`, "utf8");
        archives.set(repair.tarball, bytes);
        const target = resolve(appRoot, repair.path);
        mkdirSync(target, { recursive: true });
        writeFileSync(
          join(target, "package.json"),
          `${JSON.stringify({ name: repair.name, version: repair.fromVersion })}\n`
        );
        return repair;
      })
    };

    const result = await sanitizeRuntimeDependencies({
      appRoot,
      lock: syntheticLock,
      fetchImplementation: async (url: string) => {
        const bytes = archives.get(url);
        if (!bytes) return new Response(null, { status: 404 });
        return new Response(bytes, { status: 200 });
      },
      integrityImplementation: () => undefined,
      retainImplementation: () => ({ fileCount: lock.enrollmentWebSocketRuntime.files.length }),
      extractImplementation: async ({
        destination,
        repair
      }: {
        destination: string;
        repair: Repair;
      }) => {
        mkdirSync(destination, { recursive: true });
        const dependencies = Object.fromEntries(
          repair.dependencyNames.map((name) => [name, "fixture"])
        );
        writeFileSync(
          join(destination, "package.json"),
          `${JSON.stringify({
            name: repair.name,
            version: repair.toVersion,
            dependencies
          })}\n`
        );
      }
    });

    expect(result).toEqual({ status: "repaired", packageCount: 8 });
    for (const repair of syntheticLock.repairs) {
      const manifest = JSON.parse(
        readFileSync(resolve(appRoot, repair.path, "package.json"), "utf8")
      ) as { version: string };
      expect(manifest.version).toBe(repair.toVersion);
    }
  });

  it("retains only hash-locked non-executable ws runtime files", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "vera-runtime-ws-source-"));
    const runtimeRoot = mkdtempSync(join(tmpdir(), "vera-runtime-ws-target-"));
    temporaryDirectories.push(appRoot, runtimeRoot);
    const sourceRoot = join(appRoot, "node_modules", "ws");
    mkdirSync(sourceRoot, { recursive: true });
    const packageBytes = Buffer.from(
      `${JSON.stringify({ name: "ws", version: "8.21.0" })}\n`,
      "utf8"
    );
    const wrapperBytes = Buffer.from("export const WebSocketServer = class {};\n", "utf8");
    writeFileSync(join(sourceRoot, "package.json"), packageBytes);
    writeFileSync(join(sourceRoot, "wrapper.mjs"), wrapperBytes);
    writeFileSync(join(sourceRoot, "unexpected-executable"), "must-not-copy", { mode: 0o755 });
    const runtime = {
      packageName: "ws",
      version: "8.21.0",
      sourcePath: "node_modules/ws",
      targetPath: "/opt/vera/node_modules/ws",
      files: [
        {
          path: "package.json",
          sha256: createHash("sha256").update(packageBytes).digest("hex")
        },
        {
          path: "wrapper.mjs",
          sha256: createHash("sha256").update(wrapperBytes).digest("hex")
        }
      ]
    };

    expect(retainEnrollmentWebSocketRuntime({ appRoot, runtimeRoot, runtime })).toEqual({
      fileCount: 2
    });
    const target = join(runtimeRoot, "node_modules", "ws");
    expect(readFileSync(join(target, "wrapper.mjs"), "utf8")).toBe(wrapperBytes.toString());
    expect(statSync(join(target, "wrapper.mjs")).mode & 0o777).toBe(0o444);
    expect(() => statSync(join(target, "unexpected-executable"))).toThrow();
    chmodSync(target, 0o755);
  });

  it("rejects a repair path outside the application root", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "vera-runtime-sanitizer-path-"));
    temporaryDirectories.push(appRoot);
    expect(() => resolveRepairTarget(appRoot, "../outside")).toThrow(
      "Runtime repair path must remain below the application root."
    );
  });
});
