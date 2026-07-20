import type { DuplicateOverride, DuplicateOverrideRevocation } from "@vera/domain";

export class DuplicateOverrideError extends Error {
  readonly code: "invalid_override_reference" | "conflicting_override";

  constructor(code: "invalid_override_reference" | "conflicting_override", message: string) {
    super(message);
    this.name = "DuplicateOverrideError";
    this.code = code;
  }
}

function compareOverride(left: DuplicateOverride, right: DuplicateOverride): number {
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id, "en")
    : left.createdAt.localeCompare(right.createdAt, "en");
}

function identityKey(override: DuplicateOverride): string {
  return override.sourceRecordIds.join("\u0000");
}

export function resolveActiveOverrides(
  overrides: readonly DuplicateOverride[],
  revocations: readonly DuplicateOverrideRevocation[] = []
): readonly DuplicateOverride[] {
  const revokedIds = new Set(revocations.map((revocation) => revocation.overrideId));
  const selected = new Map<string, DuplicateOverride>();
  for (const override of overrides) {
    if (revokedIds.has(override.id)) continue;
    const key = identityKey(override);
    const current = selected.get(key);
    if (current === undefined || compareOverride(current, override) < 0) {
      selected.set(key, override);
    }
  }
  return [...selected.values()].sort(compareOverride);
}

export function assertOverrideReferences(
  overrides: readonly DuplicateOverride[],
  sourceRecordIds: ReadonlySet<string>,
  canonicalListingIds: ReadonlySet<string>
): void {
  for (const override of overrides) {
    const missingSource = override.sourceRecordIds.find((id) => !sourceRecordIds.has(id));
    if (missingSource !== undefined) {
      throw new DuplicateOverrideError(
        "invalid_override_reference",
        `Override ${override.id} references an unknown source record.`
      );
    }
    if (
      override.survivorCanonicalId !== null &&
      !canonicalListingIds.has(override.survivorCanonicalId)
    ) {
      throw new DuplicateOverrideError(
        "invalid_override_reference",
        `Override ${override.id} references an unknown survivor canonical listing.`
      );
    }
  }
}
