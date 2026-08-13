import { z } from "zod";

import { ListingSourceLabelSchema, type ListingSourceLabel } from "./primitives.ts";

export const ObservedListingUrlClassificationSchema = z.enum(["listing", "non_listing", "unknown"]);

export type ObservedListingUrlClassification = z.infer<
  typeof ObservedListingUrlClassificationSchema
>;

const SENSITIVE_QUERY_KEY =
  /^(?:password|token|access_token|refresh_token|authorization|secret|cookie|session|sessionid)$/iu;

interface SafeObservedUrl {
  readonly hostname: string;
  readonly pathname: string;
}

function safeHttpsUrl(value: string): SafeObservedUrl | null {
  const match = /^https:\/\/([^/?#:@]+)([^#]*)(?:#(.*))?$/u.exec(value);
  const hostname = match?.[1];
  const suffix = match?.[2] ?? "";
  const fragment = match?.[3];
  if (
    hostname === undefined ||
    hostname.includes(":") ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    !hostname.includes(".") ||
    !(suffix === "" || suffix.startsWith("/") || suffix.startsWith("?"))
  ) {
    return null;
  }
  const parameterSections = [suffix.split("?", 2)[1], fragment].filter(
    (section): section is string => section !== undefined
  );
  for (const section of parameterSections) {
    try {
      for (const part of section.split("&")) {
        const key = decodeURIComponent(part.split("=", 1)[0] ?? "");
        if (SENSITIVE_QUERY_KEY.test(key)) return null;
      }
    } catch {
      return null;
    }
  }
  return { hostname, pathname: suffix.split("?", 1)[0] || "/" };
}

function expectedHostname(source: ListingSourceLabel): string | null {
  switch (source) {
    case "zillow":
      return "www.zillow.com";
    case "apartments_com":
      return "www.apartments.com";
    case "facebook_marketplace":
      return "www.facebook.com";
    case "bu_off_campus":
      return "offcampus.bu.edu";
    case "craigslist":
    case "custom_website":
    case "rentcast":
    case "other":
      return null;
  }
}

export function classifyObservedListingUrl(input: {
  readonly source: ListingSourceLabel;
  readonly url: string;
  readonly allowedDomain?: string;
}): ObservedListingUrlClassification {
  const source = ListingSourceLabelSchema.parse(input.source);
  const parsed = safeHttpsUrl(input.url);
  if (!parsed) return "non_listing";

  if (source === "craigslist") {
    if (
      parsed.hostname === "www.craigslist.org" &&
      /^\/view\/d\/[a-z0-9-]+\/[A-Za-z0-9]+\/?$/u.test(parsed.pathname)
    ) {
      return "listing";
    }
    if (parsed.hostname.endsWith(".craigslist.org") && /\/\d+\.html$/u.test(parsed.pathname)) {
      return "listing";
    }
    return "non_listing";
  }

  if (source === "custom_website") {
    return input.allowedDomain === undefined || parsed.hostname === input.allowedDomain
      ? "unknown"
      : "non_listing";
  }

  const hostname = expectedHostname(source);
  if (hostname === null || parsed.hostname !== hostname) return "non_listing";

  if (source === "bu_off_campus") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (
      segments.length >= 4 &&
      segments.length <= 6 &&
      segments[0] === "housing" &&
      segments[1] === "property"
    ) {
      return "listing";
    }
    if (
      segments[0] === "housing" &&
      (segments[1]?.startsWith("campus-") === true ||
        segments[1]?.startsWith("neighborhood-") === true)
    ) {
      return "non_listing";
    }
    return "unknown";
  }

  if (source === "apartments_com") {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1)?.toLowerCase();
    if (
      last !== undefined &&
      new Set([
        "parking",
        "balcony",
        "pet-friendly",
        "utilities-included",
        "furnished",
        "short-term",
        "cheap",
        "luxury"
      ]).has(last)
    ) {
      return "non_listing";
    }
    if (segments[0] === "search" || segments.length === 0) return "non_listing";
    return segments.length >= 2 ? "listing" : "unknown";
  }

  if (source === "zillow") {
    if (/^\/(?:homedetails|apartments)\//u.test(parsed.pathname)) return "listing";
    if (/^\/(?:homes|rentals|boston-ma)\/?/u.test(parsed.pathname)) return "non_listing";
    return "unknown";
  }

  if (source === "facebook_marketplace") {
    if (/^\/marketplace\/item\/\d+\/?$/u.test(parsed.pathname)) return "listing";
    if (/^\/marketplace(?:\/|$)/u.test(parsed.pathname)) return "non_listing";
    return "unknown";
  }

  return "unknown";
}

export function isSafeObservedHttpsUrl(value: string): boolean {
  return safeHttpsUrl(value) !== null;
}

export function observedHttpsHostname(value: string): string | null {
  return safeHttpsUrl(value)?.hostname ?? null;
}
