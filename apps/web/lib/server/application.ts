import {
  checkPostgresReadiness,
  createPostgresMaritimeOperationsRepository,
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig
} from "@vera/db";

import { createVeraAuth } from "./auth.ts";
import { parseIdentityAuthEnvironment } from "./auth-config.ts";
import {
  createHostedCalendarApplication,
  createUnconfiguredCalendarApplication
} from "./calendar-application.ts";
import { createGoogleIntegrationOAuth } from "./google-integration-oauth.ts";
import { createGmailIntegrationOAuth } from "./gmail-integration-oauth.ts";
import { parseGoogleIntegrationEnvironment } from "./integration-config.ts";
import { parseHostedRuntimePolicy } from "./hosted-runtime-policy.ts";
import {
  getRegisteredApplication,
  registerApplication,
  type VeraApplication
} from "./application-registry.ts";

type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface ShutdownTarget {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  removeListener(signal: ShutdownSignal, listener: () => void): unknown;
  exit(code: number): unknown;
}

export function installHostedApplicationShutdown(
  application: Pick<VeraApplication, "close">,
  target: ShutdownTarget = process
): () => void {
  let stopping = false;
  const handleShutdown = () => {
    if (stopping) return;
    stopping = true;
    unregister();
    void application.close().then(
      () => target.exit(0),
      () => target.exit(1)
    );
  };
  const unregister = () => {
    target.removeListener("SIGINT", handleShutdown);
    target.removeListener("SIGTERM", handleShutdown);
  };

  target.once("SIGINT", handleShutdown);
  target.once("SIGTERM", handleShutdown);
  return unregister;
}

export function createPostgresApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env
): VeraApplication {
  const postgres = parsePostgresConfig(environment);
  parseIdentityAuthEnvironment(environment);
  const runtimePolicy = parseHostedRuntimePolicy(environment);
  const configuredGoogleIntegration = parseGoogleIntegrationEnvironment(environment);
  const googleIntegration = runtimePolicy.integrationsDisabled ? null : configuredGoogleIntegration;
  const connection = openPostgresConnection(postgres);
  try {
    const repositoryProvider = createPostgresRepositoryProvider(connection);
    const auth = createVeraAuth(connection, environment);
    const calendar =
      googleIntegration === null
        ? createUnconfiguredCalendarApplication()
        : createHostedCalendarApplication({
            configuration: googleIntegration,
            oauth: createGoogleIntegrationOAuth({
              configuration: googleIntegration,
              repositoryProvider
            })
          });

    return {
      mode: "hosted",
      repositoryProvider,
      auth,
      calendar,
      gmailOAuth:
        googleIntegration === null
          ? null
          : createGmailIntegrationOAuth({ configuration: googleIntegration, repositoryProvider }),
      maritimeOperations: createPostgresMaritimeOperationsRepository(connection.db),
      demoUserId: null,
      readiness: () => checkPostgresReadiness(connection, { service: "vera-web" }),
      close: () => connection.close()
    };
  } catch (error: unknown) {
    void connection.close().catch(() => {});
    throw error;
  }
}

export function getHostedApplication(): VeraApplication {
  const registered = getRegisteredApplication();
  if (registered) return registered;
  const application = createPostgresApplication();
  registerApplication(application);
  installHostedApplicationShutdown(application);
  return application;
}
