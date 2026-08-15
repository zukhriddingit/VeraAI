import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface StoreListing {
  readonly name?: unknown;
  readonly summary?: unknown;
  readonly detailedDescription?: unknown;
  readonly category?: unknown;
  readonly homepageUrl?: unknown;
  readonly privacyUrl?: unknown;
  readonly supportUrl?: unknown;
  readonly distribution?: {
    readonly visibility?: unknown;
    readonly trustedTesters?: unknown;
    readonly deferredPublishing?: unknown;
  };
}

export function findStoreAssetViolations(input: {
  readonly listing: StoreListing;
  readonly permissionText: string;
  readonly privacyText: string;
  readonly reviewerText: string;
}): readonly string[] {
  const violations: string[] = [];
  const listing = input.listing;
  if (listing.name !== "Vera Browser Connector BETA") violations.push("Store name is not exact.");
  if (
    typeof listing.detailedDescription !== "string" ||
    !listing.detailedDescription.startsWith("THIS EXTENSION IS FOR BETA TESTING.")
  )
    violations.push("Beta description prefix is missing.");
  if (
    /automatically contacts|solves CAPTCHA|production-supported public/iu.test(
      String(listing.detailedDescription)
    )
  )
    violations.push("Store listing overclaims browser behavior.");
  if (
    !String(listing.detailedDescription).includes("Connect this browser") ||
    !String(listing.detailedDescription).includes("Connecting does not share any tab")
  ) {
    violations.push("Store listing must explain one-click connection and separate tab consent.");
  }
  if (
    listing.homepageUrl !== "https://verahousing.app" ||
    listing.privacyUrl !== "https://verahousing.app/privacy/browser-connector" ||
    listing.supportUrl !== "https://verahousing.app/support/browser-connector"
  )
    violations.push("Store URLs are not exact.");
  if (listing.category !== "Productivity") violations.push("Store category is not exact.");
  if (
    listing.distribution?.visibility !== "private" ||
    listing.distribution.trustedTesters !== true ||
    listing.distribution.deferredPublishing !== true
  )
    violations.push("Store distribution must remain private and deferred.");
  for (const permission of ["debugger", "tabs", "tabGroups", "storage", "alarms"])
    if (!input.permissionText.includes(`## ${permission}`))
      violations.push(`Permission justification is missing ${permission}.`);
  if (!input.privacyText.includes("Limited Use requirements"))
    violations.push("Limited Use disclosure is missing.");
  for (const disclosure of [
    "SHA-256 digest",
    "expires within 60 seconds",
    "Connecting never shares a tab",
    "revocation clears the extension credential"
  ]) {
    if (!input.privacyText.includes(disclosure)) {
      violations.push(`Enrollment privacy disclosure is missing ${disclosure}.`);
    }
  }
  if (
    !/Connect this\s+browser/u.test(input.reviewerText) ||
    !input.reviewerText.includes("zero tabs are shared") ||
    /pairing value|enter (?:the )?.*pairing|paste (?:the )?.*pairing/iu.test(input.reviewerText)
  ) {
    violations.push("Reviewer flow must use authenticated one-click enrollment without secrets.");
  }
  return violations;
}

export function verifyStoreSource(root = resolve(".")): Record<string, unknown> {
  const directory = resolve(root, "infra/chrome/vera-openclaw-extension/store");
  const listing = JSON.parse(
    readFileSync(resolve(directory, "listing.json"), "utf8")
  ) as StoreListing;
  const permissionText = readFileSync(resolve(directory, "permission-justifications.md"), "utf8");
  const privacyText = readFileSync(resolve(directory, "privacy-practices.md"), "utf8");
  const reviewerText = readFileSync(resolve(directory, "reviewer-instructions.md"), "utf8");
  const combined = `${JSON.stringify(listing)}\n${permissionText}\n${privacyText}\n${reviewerText}`;
  if (/wss:\/\/[^\s#]+#[A-Za-z0-9_-]{16,}/u.test(combined))
    throw new Error("Store source contains pairing material.");
  const violations = findStoreAssetViolations({
    listing,
    permissionText,
    privacyText,
    reviewerText
  });
  if (violations.length)
    throw new Error(`Store source verification failed: ${violations.join(" ")}`);
  return {
    status: "passed",
    visibility: "private",
    deferredPublishing: true,
    metadataViolations: 0
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.stdout.write(`${JSON.stringify(verifyStoreSource(), null, 2)}\n`);
