import type { UserRepositories, UserRepositoryProvider } from "@vera/db";
import { describe, expect, it, vi } from "vitest";

import type { VeraApplication } from "./application-registry.ts";
import { createUnconfiguredCalendarApplication } from "./calendar-application.ts";
import { AuthenticationRequiredError, requireVeraSession } from "./session.ts";

const userId = "018f9f64-7b5a-7c91-a12e-111111111111";

function application(session: unknown): VeraApplication {
  const repositories = {} as UserRepositories;
  const repositoryProvider: UserRepositoryProvider = {
    forUser: vi.fn(() => repositories),
    transaction: vi.fn()
  };
  return {
    mode: "hosted",
    repositoryProvider,
    auth: {
      api: { getSession: vi.fn(async () => session) }
    } as unknown as VeraApplication["auth"],
    calendar: createUnconfiguredCalendarApplication(),
    gmailOAuth: null,
    demoUserId: null,
    readiness: vi.fn(),
    close: vi.fn()
  };
}

describe("hosted session boundary", () => {
  it("rejects missing, expired, and revoked sessions", async () => {
    for (const session of [null, { user: null }, { user: { id: "not-a-uuid" } }]) {
      await expect(requireVeraSession(new Headers(), application(session))).rejects.toThrow(
        AuthenticationRequiredError
      );
    }
  });

  it("binds repositories only from the authoritative session user", async () => {
    const app = application({ user: { id: userId, email: "safe@example.test" }, session: {} });
    const context = await requireVeraSession(
      new Headers({ "x-untrusted-user-id": "018f9f64-7b5a-7c91-a12e-222222222222" }),
      app
    );
    expect(context.userId).toBe(userId);
    expect(app.repositoryProvider.forUser).toHaveBeenCalledWith(userId);
  });

  it("uses the fixed owner only for an explicitly registered demo application", async () => {
    const app = application(null);
    const demo = { ...app, mode: "demo" as const, auth: null, demoUserId: userId };
    await expect(requireVeraSession(new Headers(), demo)).resolves.toMatchObject({
      userId,
      demoMode: true
    });
  });
});
