export type CanonicalUrlResult =
  | { readonly status: "known"; readonly url: string }
  | {
      readonly status: "unknown";
      readonly reason:
        | "empty"
        | "invalid"
        | "unsafe_scheme"
        | "credentials"
        | "fragment"
        | "non_default_port"
        | "non_public_host";
    };

function isTrackingKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.startsWith("utm_") ||
    normalized.startsWith("mc_") ||
    normalized === "fbclid" ||
    normalized === "gclid"
  );
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".lan")
  ) {
    return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized) || normalized.includes(":")) {
    return false;
  }
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/u.test(normalized);
}

interface UrlSearchParamsBoundary {
  entries(): IterableIterator<[string, string]>;
  append(key: string, value: string): void;
}

interface UrlBoundary {
  protocol: string;
  username: string;
  password: string;
  hash: string;
  port: string;
  hostname: string;
  pathname: string;
  search: string;
  searchParams: UrlSearchParamsBoundary;
  toString(): string;
}

const UrlConstructor = (globalThis as unknown as { URL: new (input: string) => UrlBoundary }).URL;

export function canonicalizeListingUrl(input: string): CanonicalUrlResult {
  const trimmed = input.normalize("NFKC").trim();
  if (trimmed.length === 0) return { status: "unknown", reason: "empty" };

  let url: UrlBoundary;
  try {
    url = new UrlConstructor(trimmed);
  } catch {
    return { status: "unknown", reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { status: "unknown", reason: "unsafe_scheme" };
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return { status: "unknown", reason: "credentials" };
  }
  if (url.hash.length > 0) return { status: "unknown", reason: "fragment" };
  if (url.port.length > 0) return { status: "unknown", reason: "non_default_port" };
  if (!isPublicHostname(url.hostname)) {
    return { status: "unknown", reason: "non_public_host" };
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/gu, "/");
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/gu, "");

  const retained = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingKey(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue, "en")
        : leftKey.localeCompare(rightKey, "en")
    );
  url.search = "";
  for (const [key, value] of retained) url.searchParams.append(key, value);

  return { status: "known", url: url.toString() };
}
