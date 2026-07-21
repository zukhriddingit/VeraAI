import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";

import { postgresSchema, type PostgresConnection } from "@vera/db";

import {
  buildIdentityAuthOptions,
  parseIdentityAuthEnvironment,
  type IdentityAuthEnvironment
} from "./auth-config.ts";

export function createVeraAuth(
  connection: PostgresConnection,
  environmentInput: Readonly<Record<string, string | undefined>> = process.env
) {
  const environment = parseIdentityAuthEnvironment(environmentInput) as IdentityAuthEnvironment;
  return betterAuth({
    ...buildIdentityAuthOptions(environment),
    database: drizzleAdapter(connection.db, {
      provider: "pg",
      schema: postgresSchema,
      usePlural: true,
      transaction: true,
      debugLogs: false
    })
  });
}

export type VeraAuth = ReturnType<typeof createVeraAuth>;
