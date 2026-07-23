import { VeraUserIdSchema, type VeraUserId } from "@vera/domain";
import type { UserRepositories, UserRepositoryProvider } from "@vera/db";

import { getHostedApplication } from "./application.ts";
import type { VeraApplication } from "./application-registry.ts";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("An authenticated Vera session is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export interface VeraRequestContext {
  readonly userId: VeraUserId;
  readonly repositories: UserRepositories;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly demoMode: boolean;
}

export async function requireVeraSession(
  requestHeaders: Headers,
  application: VeraApplication = getHostedApplication()
): Promise<VeraRequestContext> {
  if (application.mode === "demo") {
    if (application.demoUserId === null) throw new AuthenticationRequiredError();
    return {
      userId: application.demoUserId,
      repositories: application.repositoryProvider.forUser(application.demoUserId),
      repositoryProvider: application.repositoryProvider,
      demoMode: true
    };
  }

  if (application.auth === null) throw new AuthenticationRequiredError();
  const session = await application.auth.api.getSession({ headers: requestHeaders });
  const untrustedSession = session as unknown as {
    readonly user?: { readonly id?: unknown };
  } | null;
  const parsedUserId = VeraUserIdSchema.safeParse(untrustedSession?.user?.id);
  if (!parsedUserId.success) throw new AuthenticationRequiredError();

  return {
    userId: parsedUserId.data,
    repositories: application.repositoryProvider.forUser(parsedUserId.data),
    repositoryProvider: application.repositoryProvider,
    demoMode: false
  };
}
