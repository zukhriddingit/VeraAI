import { fileURLToPath } from "node:url";

import {
  createPostgresBetaAccessRepository,
  openPostgresConnection,
  parsePostgresConfig
} from "@vera/db";
import { VeraUserIdSchema, type VeraUserId } from "@vera/domain";

export function parseFounderBootstrap(input: {
  readonly arguments_: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
}): VeraUserId {
  const index = input.arguments_.indexOf("--confirm");
  if (index < 0 || index + 2 !== input.arguments_.length) {
    throw new Error("Usage: bootstrap-beta-founder --confirm <exact-user-uuid>");
  }
  const userId = VeraUserIdSchema.parse(input.arguments_[index + 1]);
  const admins = input.environment.VERA_BETA_ADMIN_USER_IDS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => VeraUserIdSchema.parse(value));
  if (!admins?.includes(userId))
    throw new Error("The confirmed founder is not an exact beta admin.");
  return userId;
}

export async function bootstrapBetaFounder(input: {
  readonly arguments_: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<string> {
  const userId = parseFounderBootstrap(input);
  const connection = openPostgresConnection(parsePostgresConfig(input.environment));
  try {
    const repository = createPostgresBetaAccessRepository(connection);
    await repository.bootstrapExistingUser({
      userId,
      approvedByUserId: userId,
      now: new Date()
    });
    if (!(await repository.isActiveUser(userId)))
      throw new Error("Founder bootstrap verification failed.");
    return `${userId} active`;
  } finally {
    await connection.close();
  }
}

async function main(): Promise<void> {
  process.stdout.write(
    `${await bootstrapBetaFounder({ arguments_: process.argv.slice(2), environment: process.env })}\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch(() => {
    process.stderr.write("Founder bootstrap failed safely.\n");
    process.exitCode = 1;
  });
}
