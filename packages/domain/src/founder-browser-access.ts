import { VeraUserIdSchema, type VeraUserId } from "./identity.ts";

export type FounderBrowserAccessDenialCode =
  | "founder_browser_allowlist_missing"
  | "founder_browser_allowlist_invalid"
  | "founder_browser_user_denied";

export type FounderBrowserAccessDecision =
  | { readonly allowed: true; readonly userId: VeraUserId }
  | { readonly allowed: false; readonly code: FounderBrowserAccessDenialCode };

export class FounderBrowserAuthorizationError extends Error {
  constructor(readonly code: FounderBrowserAccessDenialCode) {
    super(code);
    this.name = "FounderBrowserAuthorizationError";
  }
}

export function evaluateFounderBrowserAccess(
  userIdInput: VeraUserId,
  configuredUserIds: string | undefined
): FounderBrowserAccessDecision {
  const userId = VeraUserIdSchema.parse(userIdInput);
  const configured = configuredUserIds?.trim();
  if (!configured) {
    return { allowed: false, code: "founder_browser_allowlist_missing" };
  }

  const parsed = configured.split(",").map((value) => VeraUserIdSchema.safeParse(value.trim()));
  if (parsed.length === 0 || parsed.some((entry) => !entry.success)) {
    return { allowed: false, code: "founder_browser_allowlist_invalid" };
  }

  const allowed = parsed.some((entry) => entry.success && entry.data === userId);
  return allowed
    ? { allowed: true, userId }
    : { allowed: false, code: "founder_browser_user_denied" };
}

export function requireFounderBrowserAccess(
  userId: VeraUserId,
  configuredUserIds: string | undefined
): void {
  const decision = evaluateFounderBrowserAccess(userId, configuredUserIds);
  if (!decision.allowed) {
    throw new FounderBrowserAuthorizationError(decision.code);
  }
}
