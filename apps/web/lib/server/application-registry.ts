import type { VeraUserId } from "@vera/domain";
import type { ReadinessReport } from "@vera/domain";
import type {
  BetaAccessRepository,
  BrowserConnectorEnrollmentRepository,
  BrowserGatewayAssignmentRepository,
  MaritimeOperationsRepository,
  UserRepositoryProvider
} from "@vera/db";

import type { VeraAuth } from "./auth.ts";
import type { CalendarApplicationDependencies } from "./calendar-application.ts";
import type { GmailIntegrationOAuth } from "./gmail-integration-oauth.ts";
import type { BrowserGatewayRuntimeResolver } from "./browser-gateway-runtime-resolver.ts";
import type { PrivacyLifecycleService } from "./privacy-lifecycle-service.ts";

export interface VeraApplication {
  readonly mode: "hosted" | "demo";
  readonly repositoryProvider: UserRepositoryProvider;
  readonly auth: VeraAuth | null;
  readonly calendar: CalendarApplicationDependencies;
  readonly gmailOAuth: GmailIntegrationOAuth | null;
  readonly betaAccess: BetaAccessRepository | null;
  readonly browserConnectorEnrollments: BrowserConnectorEnrollmentRepository | null;
  readonly browserGatewayAssignments: BrowserGatewayAssignmentRepository | null;
  readonly browserGatewayRuntime: BrowserGatewayRuntimeResolver | null;
  readonly privacyLifecycle: PrivacyLifecycleService | null;
  readonly maritimeOperations?: MaritimeOperationsRepository;
  readonly demoUserId: VeraUserId | null;
  readiness(): Promise<ReadinessReport>;
  close(): Promise<void>;
}

const registryKey = Symbol.for("vera.application");

interface GlobalRegistry {
  [registryKey]?: VeraApplication;
}

function registry(): GlobalRegistry {
  return globalThis as GlobalRegistry;
}

export function registerApplication(application: VeraApplication): void {
  const state = registry();
  if (state[registryKey] && state[registryKey] !== application) {
    throw new Error("Vera application is already registered in this process.");
  }
  state[registryKey] = application;
}

export function getRegisteredApplication(): VeraApplication | null {
  return registry()[registryKey] ?? null;
}

export function clearApplicationForTesting(): void {
  delete registry()[registryKey];
}
