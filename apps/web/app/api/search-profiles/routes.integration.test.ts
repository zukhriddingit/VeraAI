import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SearchIntentProvider } from "@vera/ai";
import {
  createDemoRepositoryProvider,
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  seedDatabase,
  type VeraDatabaseConnection
} from "@vera/db/demo";
import {
  CreateSearchProfileResponseSchema,
  SearchIntentInterpretResponseSchema,
  type SearchIntentDraft,
  type VeraUserId
} from "@vera/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInterpretSearchIntentHandler } from "./interpret/route.ts";
import { POST as createProfile } from "./route.ts";
import {
  clearApplicationForTesting,
  registerApplication,
  type VeraApplication
} from "../../../lib/server/application-registry.ts";
import { createDemoApplication } from "../../../lib/server/demo-application.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-000000000001" as VeraUserId;
const ORIGIN = "http://127.0.0.1:3000";
const DRAFT: SearchIntentDraft = {
  schemaVersion: "1",
  profileName: "Cambridge fall search",
  locationText: "Cambridge, MA",
  targetMonthlyBudgetDollars: 2_700,
  maximumMonthlyBudgetDollars: 2_900,
  minimumBedrooms: 1,
  minimumBathrooms: 1,
  moveInEarliest: "2026-09-01",
  moveInLatest: "2026-09-30",
  pets: [],
  commuteAnchors: [],
  amenities: [{ code: "laundry_in_building", priority: "preferred" }],
  ambiguities: []
};

let directory = "";
let connection: VeraDatabaseConnection;

function request(path: string, body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body)
  });
}

function registerHosted(options: { authenticated?: boolean; demo?: boolean } = {}) {
  const application = createDemoApplication(connection);
  registerApplication(
    options.demo
      ? application
      : {
          ...application,
          mode: "hosted",
          auth: {
            api: {
              getSession: async () =>
                options.authenticated === false
                  ? null
                  : { user: { id: USER_ID }, session: { id: "session-test" } }
            }
          } as unknown as VeraApplication["auth"],
          demoUserId: null
        }
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "vera-search-profile-routes-"));
  connection = openDatabase({ filePath: join(directory, "vera.sqlite") });
  migrateDatabase(connection);
  seedDatabase(createSqliteRepositories(connection));
});

afterEach(() => {
  clearApplicationForTesting();
  connection.close();
  rmSync(directory, { recursive: true, force: true });
});

describe.sequential("search-profile routes", () => {
  it("interprets a bounded description with an injected provider", async () => {
    registerHosted();
    const provider: SearchIntentProvider = {
      providerId: "test",
      model: "synthetic",
      async interpret() {
        return DRAFT;
      }
    };
    const handler = createInterpretSearchIntentHandler({
      providerFactory: () => provider
    });

    const response = await handler(
      request("/api/search-profiles/interpret", {
        description: "One bedroom in Cambridge under $2,900."
      })
    );

    expect(response.status).toBe(200);
    expect(SearchIntentInterpretResponseSchema.parse(await response.json()).draft).toEqual(DRAFT);
  });

  it("returns a safe manual fallback when interpretation is disabled", async () => {
    registerHosted();
    const handler = createInterpretSearchIntentHandler({ providerFactory: () => null });

    const response = await handler(
      request("/api/search-profiles/interpret", {
        description: "One bedroom in Cambridge under $2,900."
      })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "interpretation_unavailable",
      message: "Search interpretation is unavailable. Enter the filters manually."
    });
  });

  it("persists a reviewed profile without invoking interpretation", async () => {
    registerHosted();

    const response = await createProfile(
      request("/api/search-profiles", { draft: DRAFT, basedOnProfileId: null })
    );
    const body = CreateSearchProfileResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.profile).toMatchObject({
      name: DRAFT.profileName,
      locationText: DRAFT.locationText,
      version: 1,
      absoluteMonthlyMaximumCents: 290_000
    });
    const repositories = createDemoRepositoryProvider(connection).forUser(USER_ID);
    expect(await repositories.searchProfiles.getById(body.profile.id)).toEqual(body.profile);
  });

  it("rejects unauthenticated and cross-origin mutations before persistence", async () => {
    const initialCount = await createDemoRepositoryProvider(connection)
      .forUser(USER_ID)
      .searchProfiles.count();
    registerHosted({ authenticated: false });
    const unauthenticated = await createProfile(
      request("/api/search-profiles", { draft: DRAFT, basedOnProfileId: null })
    );
    expect(unauthenticated.status).toBe(401);

    clearApplicationForTesting();
    registerHosted();
    const crossOrigin = await createProfile(
      request(
        "/api/search-profiles",
        { draft: DRAFT, basedOnProfileId: null },
        "https://attacker.example"
      )
    );
    expect(crossOrigin.status).toBe(403);
    expect(
      await createDemoRepositoryProvider(connection).forUser(USER_ID).searchProfiles.count()
    ).toBe(initialCount);
  });

  it("rejects demo runtime and arbitrary extra profile fields", async () => {
    registerHosted({ demo: true });
    const demo = await createProfile(
      request("/api/search-profiles", { draft: DRAFT, basedOnProfileId: null })
    );
    expect(demo.status).toBe(503);

    clearApplicationForTesting();
    registerHosted();
    const malformed = await createProfile(
      request("/api/search-profiles", {
        draft: { ...DRAFT, rawDescription: "must not persist" },
        basedOnProfileId: null
      })
    );
    expect(malformed.status).toBe(400);
  });
});
