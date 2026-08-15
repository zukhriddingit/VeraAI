import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const EXPECTED_PERMISSIONS = ["alarms", "debugger", "storage", "tabGroups", "tabs"];
const EXPECTED_MATCHES = [
  "http://127.0.0.1:3000/*",
  "http://localhost:3000/*",
  "https://app.verahousing.app/*"
];
const ICON_SIZES = [16, 32, 48, 128] as const;
const PROHIBITED_KEYS = [
  "host_permissions",
  "optional_host_permissions",
  "web_accessible_resources",
  "externally_connectable",
  "optional_permissions"
] as const;

type Manifest = Record<string, unknown>;
export interface VeraExtensionVerificationInput {
  readonly manifest: Manifest;
  readonly runtime: string;
  readonly popup: string;
  readonly iconDimensions: ReadonlyMap<string, readonly [number, number]>;
}

function sameSorted(left: readonly unknown[], right: readonly unknown[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

export function findVeraExtensionViolations(
  input: VeraExtensionVerificationInput
): readonly string[] {
  const violations: string[] = [];
  const manifest = input.manifest;
  if (
    manifest.manifest_version !== 3 ||
    manifest.name !== "Vera Browser Connector BETA" ||
    manifest.version !== "2.2.0" ||
    typeof manifest.description !== "string" ||
    !manifest.description.startsWith("THIS EXTENSION IS FOR BETA TESTING.")
  )
    violations.push("Store identity is not exact.");
  if (
    !Array.isArray(manifest.permissions) ||
    !sameSorted(manifest.permissions, EXPECTED_PERMISSIONS)
  ) {
    violations.push("Permissions are not exact.");
  }
  if (PROHIBITED_KEYS.some((key) => key in manifest))
    violations.push("Prohibited manifest authority is present.");
  const scripts = manifest.content_scripts;
  if (!Array.isArray(scripts) || scripts.length !== 1) {
    violations.push("Exactly one readiness bridge is required.");
  } else {
    const script = scripts[0] as Record<string, unknown>;
    if (!Array.isArray(script.matches) || !sameSorted(script.matches, EXPECTED_MATCHES)) {
      violations.push("Readiness bridge origins are not exact.");
    }
    if (
      JSON.stringify(script.js) !== JSON.stringify(["readiness-bridge.js"]) ||
      script.run_at !== "document_idle"
    ) {
      violations.push("Readiness bridge runtime is not exact.");
    }
  }
  const expectedIcons = Object.fromEntries(
    ICON_SIZES.map((size) => [String(size), `images/icon-${size}.png`])
  );
  const action = manifest.action as Record<string, unknown> | undefined;
  if (
    JSON.stringify(manifest.icons) !== JSON.stringify(expectedIcons) ||
    JSON.stringify(action?.default_icon) !== JSON.stringify(expectedIcons)
  )
    violations.push("Extension icon declarations are not exact.");
  if (
    ICON_SIZES.some((size) => {
      const value = input.iconDimensions.get(`icon-${size}.png`);
      return !value || value[0] !== size || value[1] !== size;
    })
  )
    violations.push("Extension icons are missing or incorrectly sized.");
  const forbidden = [
    /\beval\s*\(/u,
    /\bnew\s+Function\b/u,
    /chrome\.scripting/u,
    /executeScript/u,
    /chrome\.(?:cookies|downloads|history|identity|webRequest)/u,
    /document\.cookie/u,
    /\blocalStorage\b/u,
    /\bsessionStorage\b/u,
    /\bXMLHttpRequest\b/u,
    /\bfetch\s*\(/u,
    /console\.(?:debug|info|log|warn|error)/u
  ];
  if (forbidden.some((pattern) => pattern.test(input.runtime)))
    violations.push("Runtime contains prohibited authority.");
  if (
    !input.popup.includes("Open Vera to connect") ||
    /pairingString|<textarea|type=["']password["']/iu.test(input.popup)
  ) {
    violations.push("Popup must use one-click Vera enrollment without credential entry.");
  }
  if (input.runtime.split("https://www.zillow.com/homes/for_rent/").length !== 2) {
    violations.push("Prepared start URL is not exact.");
  }
  for (const required of [
    "openclaw-extension-relay",
    "openclaw-extension-token.",
    "browser_extension_conflict",
    "Prepare Vera Search tab",
    "about:blank",
    "vera-browser-enrollment.v1",
    "extensionVersion",
    "enrollmentProtocolVersion",
    "installationDigest",
    "event.source !== window",
    "event.origin !== window.location.origin"
  ])
    if (!input.runtime.includes(required)) violations.push(`Runtime is missing ${required}.`);
  return violations;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function verifyVeraExtension(root = resolve(".")): Promise<Record<string, unknown>> {
  const extensionDirectory = resolve(root, "infra/chrome/vera-openclaw-extension");
  const manifestText = readFileSync(resolve(extensionDirectory, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText) as Manifest;
  const runtimeFiles = [
    "background.js",
    "popup.html",
    "popup.js",
    "readiness-bridge.js",
    "modules/popup-copy.js",
    "modules/enrollment.js",
    "modules/prepared-tab.js",
    "modules/relay-core.js"
  ] as const;
  const runtime = runtimeFiles
    .map((file) => `${file}\n${readFileSync(resolve(extensionDirectory, file), "utf8")}`)
    .join("\n");
  const popup = `${readFileSync(resolve(extensionDirectory, "popup.html"), "utf8")}\n${readFileSync(
    resolve(extensionDirectory, "popup.js"),
    "utf8"
  )}`;
  const iconDimensions = new Map<string, readonly [number, number]>();
  const iconParts: Buffer[] = [];
  for (const size of ICON_SIZES) {
    const name = `icon-${size}.png`;
    const bytes = readFileSync(resolve(extensionDirectory, "images", name));
    const metadata = await sharp(bytes).metadata();
    iconDimensions.set(name, [metadata.width ?? 0, metadata.height ?? 0]);
    iconParts.push(Buffer.from(`${name}\n`), bytes);
  }
  const violations = findVeraExtensionViolations({ manifest, runtime, popup, iconDimensions });
  if (violations.length)
    throw new Error(`Vera extension verification failed: ${violations.join(" ")}`);
  const releaseLock = JSON.parse(
    readFileSync(resolve(extensionDirectory, "release-lock.json"), "utf8")
  ) as {
    schemaVersion?: unknown;
    upstream?: { version?: unknown; manifestSha256?: unknown };
    vera?: {
      name?: unknown;
      version?: unknown;
      manifestSha256?: unknown;
      runtimeSha256?: unknown;
      iconsSha256?: unknown;
    };
  };
  const manifestSha256 = sha256(manifestText);
  const runtimeSha256 = sha256(runtime);
  const iconsSha256 = sha256(Buffer.concat(iconParts));
  if (
    releaseLock.schemaVersion !== "1" ||
    releaseLock.upstream?.version !== "2.0.0" ||
    releaseLock.upstream.manifestSha256 !==
      "90dc60974ff7b68b4b487cc7040268d4ce458224beeb8bb715e56f59d23bec23" ||
    releaseLock.vera?.name !== manifest.name ||
    releaseLock.vera.version !== manifest.version ||
    releaseLock.vera.manifestSha256 !== manifestSha256 ||
    releaseLock.vera.runtimeSha256 !== runtimeSha256 ||
    releaseLock.vera.iconsSha256 !== iconsSha256
  )
    throw new Error("Vera extension release lock does not match the reviewed runtime.");
  return {
    status: "passed",
    extension: manifest.name,
    version: manifest.version,
    manifestSha256,
    runtimeSha256,
    iconsSha256,
    permissions: EXPECTED_PERMISSIONS,
    readinessBridgeOrigins: EXPECTED_MATCHES.length
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${JSON.stringify(await verifyVeraExtension(), null, 2)}\n`);
}
