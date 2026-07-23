import { fileURLToPath } from "node:url";

import { VeraUserIdSchema, type VeraUserId } from "@vera/domain";

import type { VeraDatabaseConnection } from "../connection.ts";
import { migrateDatabase as migrateSqliteDatabase, type MigrationOptions } from "../migrations.ts";
import { createSqliteRepositories } from "../sqlite-repositories.ts";
import type {
  AsyncRepository,
  BrowserCaptureAcceptanceRepository,
  BrowserIntegrationControlRepository,
  BrowserProfileControlRepository,
  CalendarOAuthStateRepository,
  GmailAlertCursorRepository,
  GmailAlertExternalReferenceRepository,
  GmailOAuthStateRepository,
  IntegrationRefreshLeaseRepository,
  MaritimeDispatchRepository,
  NotificationDeliveryRepository,
  NotificationPreferenceRepository,
  ProductionScheduleRepository,
  SyncVeraRepositories,
  UserRepositories,
  UserRepositoryProvider,
  WebPushSubscriptionRepository
} from "../repositories.ts";
import { createDemoCalendarSidecar, type DemoCalendarSidecar } from "./calendar-repositories.ts";
import { DEMO_USER_ID } from "./constants.ts";

export * from "./calendar-repositories.ts";
export * from "./constants.ts";
export * from "./viewing-fixture.ts";

export * from "../connection.ts";
export * from "../fixtures.ts";
export * from "../hashing.ts";
export * from "../paths.ts";
export * from "../repositories.ts";
export * from "../schema.ts";
export * from "../seed.ts";
export { createSqliteRepositories } from "../sqlite-repositories.ts";

const demoMigrationsFolder = fileURLToPath(new URL("../../drizzle-demo", import.meta.url));

export function migrateDatabase(
  connection: VeraDatabaseConnection,
  options: MigrationOptions = {}
): void {
  migrateSqliteDatabase(connection, {
    ...options,
    migrationsFolder: options.migrationsFolder ?? demoMigrationsFolder
  });
}

export class DemoTenantMismatchError extends Error {
  constructor() {
    super("The offline demo adapter is bound to its deterministic demo owner.");
    this.name = "DemoTenantMismatchError";
  }
}

class AsyncMutex {
  #tail: Promise<void> = Promise.resolve();

  async run<Result>(operation: () => Promise<Result>): Promise<Result> {
    let release = () => {};
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => slot);
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const transactionMutexes = new WeakMap<object, AsyncMutex>();

function mutexFor(connection: VeraDatabaseConnection): AsyncMutex {
  const key = connection.sqlite;
  const existing = transactionMutexes.get(key);
  if (existing) return existing;
  const mutex = new AsyncMutex();
  transactionMutexes.set(key, mutex);
  return mutex;
}

function assertDemoUser(input: VeraUserId): void {
  const userId = VeraUserIdSchema.parse(input);
  if (userId !== DEMO_USER_ID) throw new DemoTenantMismatchError();
}

function asyncRepository<Repository extends object>(
  repository: Repository
): AsyncRepository<Repository> {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...arguments_: readonly unknown[]) =>
        Promise.resolve().then(() => Reflect.apply(value, target, arguments_));
    }
  }) as AsyncRepository<Repository>;
}

const unavailableOAuthStates: AsyncRepository<CalendarOAuthStateRepository> = {
  async insert() {
    throw new Error("Google OAuth is unavailable in offline demo mode.");
  },
  async consume() {
    throw new Error("Google OAuth is unavailable in offline demo mode.");
  }
};

const unavailableIntegrationRefreshLeases: AsyncRepository<IntegrationRefreshLeaseRepository> = {
  async tryAcquire() {
    throw new Error("Google credential refresh is unavailable in offline demo mode.");
  },
  async release() {
    throw new Error("Google credential refresh is unavailable in offline demo mode.");
  }
};

const unavailableBrowserIntegrationControls: AsyncRepository<BrowserIntegrationControlRepository> =
  {
    async get() {
      return {
        userBrowserEnabled: false,
        zillowSourceEnabled: false,
        updatedAt: "1970-01-01T00:00:00.000Z"
      };
    },
    async upsert() {
      throw new Error("Live browser acquisition is unavailable in offline demo mode.");
    }
  };

const unavailableBrowserProfileControls: AsyncRepository<BrowserProfileControlRepository> = {
  async get() {
    return null;
  },
  async upsert() {
    throw new Error("Live browser profiles are unavailable in offline demo mode.");
  }
};

const unavailableBrowserCaptureAcceptances: AsyncRepository<BrowserCaptureAcceptanceRepository> = {
  async insert() {
    throw new Error("Live browser captures are unavailable in offline demo mode.");
  },
  async getById() {
    return null;
  },
  async getBySourceJobId() {
    return null;
  },
  async getByInvocationIdempotencyKey() {
    return null;
  }
};

function unavailable(feature: string): never {
  throw new Error(`${feature} is unavailable in offline demo mode.`);
}

const unavailableMaritimeDispatches: AsyncRepository<MaritimeDispatchRepository> = {
  async create() {
    return unavailable("Maritime dispatch");
  },
  async getById() {
    return null;
  },
  async getBySourceJobId() {
    return null;
  },
  async getByNonceHash() {
    return null;
  },
  async list() {
    return [];
  },
  async transition() {
    return unavailable("Maritime dispatch");
  }
};

const unavailableProductionSchedules: AsyncRepository<ProductionScheduleRepository> = {
  async upsert() {
    return unavailable("Production scheduling");
  },
  async getById() {
    return null;
  },
  async list() {
    return [];
  },
  async listDue() {
    return [];
  },
  async createRun() {
    return unavailable("Production scheduling");
  },
  async getRunById() {
    return null;
  },
  async getRunByIdempotencyKey() {
    return null;
  },
  async listRuns() {
    return [];
  },
  async transitionRun() {
    return unavailable("Production scheduling");
  }
};

const unavailableNotificationPreferences: AsyncRepository<NotificationPreferenceRepository> = {
  async get() {
    return null;
  },
  async upsert() {
    return unavailable("Hosted notifications");
  }
};

const unavailableWebPushSubscriptions: AsyncRepository<WebPushSubscriptionRepository> = {
  async insert() {
    return unavailable("Web Push");
  },
  async getById() {
    return null;
  },
  async getByEndpointHash() {
    return null;
  },
  async list() {
    return [];
  },
  async transition() {
    return unavailable("Web Push");
  }
};

const unavailableNotificationDeliveries: AsyncRepository<NotificationDeliveryRepository> = {
  async enqueue() {
    return unavailable("Hosted notifications");
  },
  async getById() {
    return null;
  },
  async getByIdempotencyKey() {
    return null;
  },
  async list() {
    return [];
  },
  async transition() {
    return unavailable("Hosted notifications");
  }
};

const unavailableGmailOAuthStates: AsyncRepository<GmailOAuthStateRepository> = {
  async insert() {
    return unavailable("Gmail OAuth");
  },
  async consume() {
    return unavailable("Gmail OAuth");
  }
};

const unavailableGmailAlertCursors: AsyncRepository<GmailAlertCursorRepository> = {
  async getBySourceConfigurationId() {
    return null;
  },
  async upsert() {
    return unavailable("Gmail alert ingestion");
  }
};

const unavailableGmailExternalReferences: AsyncRepository<GmailAlertExternalReferenceRepository> = {
  async insert() {
    return unavailable("Gmail alert ingestion");
  },
  async getByMessageId() {
    return null;
  }
};

function asyncUserRepositories(
  repositories: SyncVeraRepositories,
  calendarSidecar: DemoCalendarSidecar
): UserRepositories {
  return {
    integrationConnections: calendarSidecar.repositories.integrationConnections,
    integrationRefreshLeases: unavailableIntegrationRefreshLeases,
    availabilityRuleSets: calendarSidecar.repositories.availabilityRuleSets,
    calendarOAuthStates: unavailableOAuthStates,
    availabilityChecks: calendarSidecar.repositories.availabilityChecks,
    calendarHolds: calendarSidecar.repositories.calendarHolds,
    searchProfiles: asyncRepository(repositories.searchProfiles),
    rawListings: asyncRepository(repositories.rawListings),
    sourceRecords: asyncRepository(repositories.sourceRecords),
    listingPhotos: asyncRepository(repositories.listingPhotos),
    fieldProvenance: asyncRepository(repositories.fieldProvenance),
    listingExtractions: asyncRepository(repositories.listingExtractions),
    duplicateClusters: asyncRepository(repositories.duplicateClusters),
    canonicalListings: asyncRepository(repositories.canonicalListings),
    listingScores: asyncRepository(repositories.listingScores),
    riskSignals: asyncRepository(repositories.riskSignals),
    contactWorkflows: asyncRepository(repositories.contactWorkflows),
    approvals: asyncRepository(repositories.approvals),
    viewings: asyncRepository(repositories.viewings),
    activityEvents: asyncRepository(repositories.activityEvents),
    sourcePolicyManifests: asyncRepository(repositories.sourcePolicyManifests),
    sourceJobs: asyncRepository(repositories.sourceJobs),
    sourceJobAttempts: asyncRepository(repositories.sourceJobAttempts),
    browserNodes: asyncRepository(repositories.browserNodes),
    maritimeDispatches: unavailableMaritimeDispatches,
    productionSchedules: unavailableProductionSchedules,
    notificationPreferences: unavailableNotificationPreferences,
    webPushSubscriptions: unavailableWebPushSubscriptions,
    notificationDeliveries: unavailableNotificationDeliveries,
    gmailOAuthStates: unavailableGmailOAuthStates,
    gmailAlertCursors: unavailableGmailAlertCursors,
    gmailAlertExternalReferences: unavailableGmailExternalReferences,
    browserIntegrationControls: unavailableBrowserIntegrationControls,
    browserProfileControls: unavailableBrowserProfileControls,
    browserCaptureAcceptances: unavailableBrowserCaptureAcceptances,
    normalizationJobs: asyncRepository(repositories.normalizationJobs),
    decisionJobs: asyncRepository(repositories.decisionJobs),
    duplicateOverrides: asyncRepository(repositories.duplicateOverrides),
    decisionHistory: asyncRepository(repositories.decisionHistory),
    decisionReconciliation: asyncRepository(repositories.decisionReconciliation)
  };
}

export function createDemoRepositoryProvider(
  connection: VeraDatabaseConnection,
  options: { readonly calendarSidecar?: DemoCalendarSidecar } = {}
): UserRepositoryProvider {
  const calendarSidecar = options.calendarSidecar ?? createDemoCalendarSidecar();
  return {
    forUser(userId) {
      assertDemoUser(userId);
      return asyncUserRepositories(createSqliteRepositories(connection), calendarSidecar);
    },
    async transaction(userId, operation) {
      assertDemoUser(userId);
      return mutexFor(connection).run(async () => {
        const sidecarSnapshot = calendarSidecar.snapshot();
        connection.sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = await operation(
            asyncUserRepositories(createSqliteRepositories(connection), calendarSidecar)
          );
          connection.sqlite.exec("COMMIT");
          return result;
        } catch (error: unknown) {
          calendarSidecar.restore(sidecarSnapshot);
          try {
            connection.sqlite.exec("ROLLBACK");
          } catch {
            // Preserve the original error after restoring both persistence boundaries.
          }
          throw error;
        }
      });
    }
  };
}
