import { encryptCredential, StaticCredentialKeyProvider, type UserRepositories } from "@vera/db";
import { GMAIL_READONLY_SCOPE, type IntegrationConnection, type VeraUserId } from "@vera/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { refreshGmailAccessToken, type TokenFetch } from "./google-gmail-access.ts";

const USER_ID = "018f9f64-7b5a-7c91-a12e-123456789abc" as VeraUserId;
const INTEGRATION_ID = "018f9f64-7b5a-7c91-a12e-123456789abd";

afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const keyProvider = new StaticCredentialKeyProvider(
    "test-key",
    new Map([["test-key", Buffer.alloc(32, 7)]])
  );
  const encryptedRefreshToken = await encryptCredential(
    "synthetic-refresh-token",
    { userId: USER_ID, integrationId: INTEGRATION_ID, provider: "google" },
    keyProvider
  );
  const connection: IntegrationConnection = {
    id: INTEGRATION_ID,
    userId: USER_ID,
    provider: "google",
    providerSubjectId: "google-subject-1",
    displayEmail: "founder@example.test",
    encryptedRefreshToken,
    grantedScopes: [GMAIL_READONLY_SCOPE],
    tokenExpiresAt: null,
    status: "connected",
    lastSuccessfulUseAt: null,
    createdAt: "2026-07-22T12:00:00.000Z",
    updatedAt: "2026-07-22T12:00:00.000Z"
  };
  const upsert = vi.fn(async (value: IntegrationConnection) => value);
  let leaseOwner: string | null = null;
  const tryAcquire = vi.fn(async (input: { readonly leaseOwner: string }) => {
    if (leaseOwner !== null) return false;
    leaseOwner = input.leaseOwner;
    return true;
  });
  const release = vi.fn(async (input: { readonly leaseOwner: string }) => {
    if (leaseOwner !== input.leaseOwner) return false;
    leaseOwner = null;
    return true;
  });
  const repositories = {
    integrationConnections: {
      list: vi.fn(async () => [connection]),
      upsert
    },
    integrationRefreshLeases: { tryAcquire, release }
  } as unknown as UserRepositories;
  return { keyProvider, repositories, upsert, tryAcquire, release };
}

describe("refreshGmailAccessToken", () => {
  it("times out a stalled token exchange", async () => {
    vi.useFakeTimers();
    const { keyProvider, repositories, release } = await fixture();
    const fetchImplementation: TokenFetch = vi.fn(
      async (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
    );

    const pending = expect(
      refreshGmailAccessToken({
        userId: USER_ID,
        repositories,
        keyProvider,
        clientId: "google-client-id",
        clientSecret: "synthetic-client-secret",
        timeoutMilliseconds: 1_000,
        fetchImplementation
      })
    ).rejects.toMatchObject({ code: "gmail_timeout", retryable: true });

    await vi.advanceTimersByTimeAsync(1_001);
    await pending;
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("honors caller cancellation and does not retry", async () => {
    const { keyProvider, repositories, release } = await fixture();
    const fetchImplementation: TokenFetch = vi.fn(
      async (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
    );
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(
      refreshGmailAccessToken({
        userId: USER_ID,
        repositories,
        keyProvider,
        clientId: "google-client-id",
        clientSecret: "synthetic-client-secret",
        signal: controller.signal,
        fetchImplementation
      })
    ).rejects.toMatchObject({ code: "gmail_cancelled", retryable: true });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("uses a fresh deadline for one bounded retry after a provider 5xx", async () => {
    const { keyProvider, repositories, upsert } = await fixture();
    const signals: AbortSignal[] = [];
    const fetchImplementation: TokenFetch = vi.fn(async (_url, init) => {
      if (init.signal) signals.push(init.signal);
      if (signals.length === 1) {
        return {
          ok: false,
          status: 503,
          async json() {
            return {};
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { access_token: "synthetic-access-token", scope: GMAIL_READONLY_SCOPE };
        }
      };
    });

    await expect(
      refreshGmailAccessToken({
        userId: USER_ID,
        repositories,
        keyProvider,
        clientId: "google-client-id",
        clientSecret: "synthetic-client-secret",
        fetchImplementation,
        now: () => new Date("2026-07-22T13:00:00.000Z")
      })
    ).resolves.toBe("synthetic-access-token");

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "connected",
        lastSuccessfulUseAt: "2026-07-22T13:00:00.000Z"
      })
    );
  });

  it("allows only one in-flight provider refresh and releases the lease afterward", async () => {
    const { keyProvider, repositories, tryAcquire, release } = await fixture();
    let resolveFetch = (_response: {
      ok: true;
      status: 200;
      json(): Promise<{ access_token: string; scope: string }>;
    }) => {};
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchImplementation: TokenFetch = vi.fn(async () => {
      markStarted();
      return new Promise<Awaited<ReturnType<TokenFetch>>>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const common = {
      userId: USER_ID,
      repositories,
      keyProvider,
      clientId: "google-client-id",
      clientSecret: "synthetic-client-secret",
      fetchImplementation,
      now: () => new Date("2026-07-22T13:00:00.000Z")
    } as const;

    const first = refreshGmailAccessToken({ ...common, createId: () => "worker-a" });
    await started;
    await expect(
      refreshGmailAccessToken({ ...common, createId: () => "worker-b" })
    ).rejects.toMatchObject({ code: "gmail_temporarily_unavailable", retryable: true });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(tryAcquire).toHaveBeenCalledTimes(2);

    resolveFetch({
      ok: true,
      status: 200,
      async json() {
        return { access_token: "synthetic-access-token", scope: GMAIL_READONLY_SCOPE };
      }
    });
    await expect(first).resolves.toBe("synthetic-access-token");
    expect(release).toHaveBeenCalledOnce();
  });
});
