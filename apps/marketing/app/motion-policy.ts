export const MARKETING_SECTION_IDS = [
  "product",
  "evidence",
  "control",
  "browser-connector",
  "beta"
] as const;

export type MarketingSectionId = (typeof MARKETING_SECTION_IDS)[number];

export function navigationBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

export function normalizedSectionHash(hash: string): MarketingSectionId | null {
  const candidate = hash.replace(/^#/, "");
  return MARKETING_SECTION_IDS.find((id) => id === candidate) ?? null;
}
