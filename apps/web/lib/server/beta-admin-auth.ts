import { VeraUserIdSchema, type VeraUserId } from "@vera/domain";

export class BetaAdminRequiredError extends Error {
  constructor() {
    super("Private beta administration is unavailable.");
    this.name = "BetaAdminRequiredError";
  }
}

export function requireBetaAdmin(
  userId: VeraUserId,
  environment: Readonly<Record<string, string | undefined>> = process.env
): void {
  const configured = environment.VERA_BETA_ADMIN_USER_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!configured?.length) throw new BetaAdminRequiredError();
  const allowed = configured.map((value) => VeraUserIdSchema.safeParse(value));
  if (allowed.some((entry) => !entry.success)) throw new BetaAdminRequiredError();
  if (!allowed.some((entry) => entry.success && entry.data === userId)) {
    throw new BetaAdminRequiredError();
  }
}
