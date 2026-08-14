const STORE_ITEM = /^https:\/\/chromewebstore\.google\.com\/detail\/[a-z0-9-]+\/[a-p]{32}$/u;

export function approvedBrowserConnectorLink(
  environment: Readonly<Record<string, string | undefined>>
): string | null {
  if (environment.VERA_CHROME_STORE_RELEASE_STATUS !== "published") return null;
  const url = environment.VERA_CHROME_STORE_ITEM_URL?.trim();
  return url && STORE_ITEM.test(url) ? url : null;
}
