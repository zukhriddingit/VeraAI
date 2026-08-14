import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";

import {
  postgresSchema,
  type BetaAccessRepository,
  type PostgresConnection
} from "@vera/db";
import { VeraUserIdSchema } from "@vera/domain";

import {
  buildIdentityAuthOptions,
  parseIdentityAuthEnvironment,
  type IdentityAuthEnvironment
} from "./auth-config.ts";

export function createVeraAuth(
  connection: PostgresConnection,
  environmentInput: Readonly<Record<string, string | undefined>> = process.env,
  betaAccess?: BetaAccessRepository | null
) {
  const environment = parseIdentityAuthEnvironment(environmentInput) as IdentityAuthEnvironment;
  const gateEnabled = environmentInput.VERA_BETA_ACCESS_GATE_ENABLED === "1";
  if (gateEnabled && !betaAccess) {
    throw new Error("The private beta access repository is required when the gate is enabled.");
  }
  const databaseHooks = betaAccess
    ? createBetaIdentityHooks(betaAccess, environmentInput)
    : undefined;
  return betterAuth({
    ...buildIdentityAuthOptions(environment),
    database: drizzleAdapter(connection.db, {
      provider: "pg",
      schema: postgresSchema,
      usePlural: true,
      transaction: true,
      debugLogs: false
    }),
    ...(databaseHooks ? { databaseHooks } : {})
  });
}

export function createBetaIdentityHooks(
  repository: BetaAccessRepository,
  environment: Readonly<Record<string, string | undefined>> = process.env
) {
  const gateEnabled = environment.VERA_BETA_ACCESS_GATE_ENABLED === "1";
  return {
    user: {
      create: {
        before: async (user: { email: string; emailVerified: boolean }) => {
          if (!gateEnabled) return { data: user };
          if (!user.emailVerified) throw new Error("Private beta access is required.");
          const invitation = await repository.findInvitedByEmail(user.email);
          if (invitation === null || invitation.userId !== null) {
            throw new Error("Private beta access is required.");
          }
          return { data: user };
        },
        after: async (user: { id: string; email: string; emailVerified: boolean }) => {
          if (!gateEnabled) return;
          if (!user.emailVerified) throw new Error("Private beta access is required.");
          await repository.bindInvitedMembership({
            email: user.email,
            userId: VeraUserIdSchema.parse(user.id),
            now: new Date()
          });
        }
      }
    },
    session: {
      create: {
        before: async (session: { userId: string }) => {
          if (!gateEnabled) return { data: session };
          if (!(await repository.isActiveUser(VeraUserIdSchema.parse(session.userId)))) {
            throw new Error("Private beta access is required.");
          }
          return { data: session };
        }
      }
    }
  };
}

export type VeraAuth = ReturnType<typeof createVeraAuth>;
