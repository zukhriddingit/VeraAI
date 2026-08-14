import {
  checkPostgresReadiness,
  createPostgresBetaAccessRepository,
  createPostgresBrowserGatewayAssignmentRepository,
  createPostgresMaritimeOperationsRepository,
  createPostgresRepositoryProvider,
  openPostgresConnection,
  parsePostgresConfig,
  type UserRepositoryProvider
} from "@vera/db";

import { createVeraAuth } from "./auth.ts";
import { parseIdentityAuthEnvironment } from "./auth-config.ts";
import {
  createLazyGoogleIntegrationBindings,
  type GoogleIntegrationBindings
} from "./google-integration-runtime.ts";
import {
  parseGoogleIntegrationEnvironment,
  type GoogleIntegrationEnvironment
} from "./integration-config.ts";
import { parseHostedRuntimePolicy } from "./hosted-runtime-policy.ts";
import {
  getRegisteredApplication,
  registerApplication,
  type VeraApplication
} from "./application-registry.ts";
import { createUnconfiguredCalendarApplication } from "./unconfigured-calendar-application.ts";

type ShutdownSignal = "SIGINT" | "SIGTERM";
type GoogleBindingFactory = (input: {
  readonly configuration: GoogleIntegrationEnvironment;
  readonly repositoryProvider: UserRepositoryProvider;
}) => GoogleIntegrationBindings;

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

export function composeHostedGoogleIntegrations(input: {
  readonly configuration: GoogleIntegrationEnvironment | null;
  readonly repositoryProvider: UserRepositoryProvider;
  readonly createBindings?: GoogleBindingFactory;
}): Pick<VeraApplication, "calendar" | "gmailOAuth"> {
  if (input.configuration === null) {
    return {
      calendar: createUnconfiguredCalendarApplication(),
      gmailOAuth: null
    };
  }
  const createBindings = input.createBindings ?? createLazyGoogleIntegrationBindings;
  return createBindings({
    configuration: input.configuration,
    repositoryProvider: input.repositoryProvider
  });
}

export function createPostgresApplication(
  environment: Readonly<Record<string, string | undefined>> = process.env
): VeraApplication {
  const postgres = parsePostgresConfig(environment);
  parseIdentityAuthEnvironment(environment);
  const runtimePolicy = parseHostedRuntimePolicy(environment);
  const googleIntegration = runtimePolicy.integrationsDisabled
    ? null
    : parseGoogleIntegrationEnvironment(environment);
  const connection = openPostgresConnection(postgres);
  try {
    const repositoryProvider = createPostgresRepositoryProvider(connection);
    const betaAccess = createPostgresBetaAccessRepository(connection);
    const auth = createVeraAuth(connection, environment, betaAccess);
    const googleBindings = composeHostedGoogleIntegrations({
      configuration: googleIntegration,
      repositoryProvider
    });

    return {
      mode: "hosted",
      repositoryProvider,
      auth,
      calendar: googleBindings.calendar,
      gmailOAuth: googleBindings.gmailOAuth,
      betaAccess,
      browserGatewayAssignments: createPostgresBrowserGatewayAssignmentRepository(connection),
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
