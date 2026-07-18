import type { ListingSourceLabel } from "@vera/domain";
import { z } from "zod";

import { InvalidCaptureUrlError } from "./errors.ts";

export const MAX_PROVENANCE_URL_LENGTH = 2_048;

export const UrlClassificationSchema = z
  .object({
    canonicalUrl: z.string().url().max(MAX_PROVENANCE_URL_LENGTH),
    hostname: z.string().min(1).max(253),
    source: z.enum(["zillow", "facebook_marketplace", "craigslist", "apartments_com", "other"]),
    browserAccess: z.enum(["policy_entry_present", "manual_policy_required"])
  })
  .strict();

export interface UrlClassification {
  readonly canonicalUrl: string;
  readonly hostname: string;
  readonly source: ListingSourceLabel;
  readonly browserAccess: "policy_entry_present" | "manual_policy_required";
}

function matchesDomain(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function hasExplicitPort(rawUrl: string): boolean {
  const authorityMatch = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/iu.exec(rawUrl);
  if (authorityMatch === null) {
    return false;
  }

  const authority = authorityMatch[1] ?? "";
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.startsWith("[")) {
    return /^\[[^\]]+\]:\d+$/u.test(hostPort);
  }
  return /:\d+$/u.test(hostPort);
}

function classifySource(hostname: string, pathname: string): ListingSourceLabel {
  if (matchesDomain(hostname, "zillow.com")) {
    return "zillow";
  }
  if (
    matchesDomain(hostname, "facebook.com") &&
    (pathname === "/marketplace" || pathname.startsWith("/marketplace/"))
  ) {
    return "facebook_marketplace";
  }
  if (matchesDomain(hostname, "craigslist.org")) {
    return "craigslist";
  }
  if (matchesDomain(hostname, "apartments.com")) {
    return "apartments_com";
  }
  return "other";
}

export function validateAndClassifyProvenanceUrl(rawUrl: string): UrlClassification {
  if (
    rawUrl.length === 0 ||
    rawUrl.length > MAX_PROVENANCE_URL_LENGTH ||
    rawUrl.trim() !== rawUrl
  ) {
    throw new InvalidCaptureUrlError("invalid_length_or_whitespace");
  }

  if (hasExplicitPort(rawUrl)) {
    throw new InvalidCaptureUrlError("explicit_port");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InvalidCaptureUrlError("malformed_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidCaptureUrlError("unsupported_scheme");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new InvalidCaptureUrlError("credentials_not_allowed");
  }
  if (parsed.hash.length > 0) {
    throw new InvalidCaptureUrlError("fragment_not_allowed");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  if (hostname.length === 0 || hostname.length > 253) {
    throw new InvalidCaptureUrlError("invalid_hostname");
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    !hostname.includes(".")
  ) {
    throw new InvalidCaptureUrlError("local_hostname");
  }
  if (
    hostname.startsWith("[") ||
    hostname.endsWith("]") ||
    hostname.includes(":") ||
    /^\d+(?:\.\d+){3}$/u.test(hostname)
  ) {
    throw new InvalidCaptureUrlError("ip_literal");
  }

  parsed.hostname = hostname;
  const canonicalUrl = parsed.toString();
  if (canonicalUrl.length > MAX_PROVENANCE_URL_LENGTH) {
    throw new InvalidCaptureUrlError("canonical_url_too_long");
  }

  const source = classifySource(hostname, parsed.pathname);
  return UrlClassificationSchema.parse({
    canonicalUrl,
    hostname,
    source,
    browserAccess: source === "other" ? "manual_policy_required" : "policy_entry_present"
  });
}
