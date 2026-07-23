import { VeraUserIdSchema, type VeraUserId } from "@vera/domain";

export class OperatorAuthorizationError extends Error {
  readonly status = 403;
  constructor() {
    super("Operator access is required.");
    this.name = "OperatorAuthorizationError";
  }
}

export function parseOperatorUserIds(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ReadonlySet<VeraUserId> {
  const value = environment.VERA_OPERATOR_USER_IDS?.trim();
  if (!value) return new Set();
  const ids = value.split(",").map((candidate) => VeraUserIdSchema.parse(candidate.trim()));
  return new Set(ids);
}

export function requireOperator(
  userIdInput: VeraUserId,
  environment: Readonly<Record<string, string | undefined>> = process.env
): VeraUserId {
  const userId = VeraUserIdSchema.parse(userIdInput);
  if (!parseOperatorUserIds(environment).has(userId)) throw new OperatorAuthorizationError();
  return userId;
}
