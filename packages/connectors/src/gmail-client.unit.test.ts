import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleGmailClient, type GmailFetch } from "./gmail-client.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("GoogleGmailClient", () => {
  it("uses only a configured narrow search and read-only message endpoints", async () => {
    const calls: string[] = [];
    const fetcher: GmailFetch = async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { messages: [{ id: "message-1" }], historyId: "22" };
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: "message-1",
            historyId: "22",
            internalDate: "1784692800000",
            payload: {
              headers: [
                { name: "From", value: "alerts@zillow.com" },
                { name: "Subject", value: "New listing" }
              ],
              mimeType: "text/plain",
              body: {
                data: Buffer.from(
                  "See https://www.zillow.com/homedetails/123_zpid/",
                  "utf8"
                ).toString("base64url")
              }
            }
          };
        }
      };
    };
    const client = new GoogleGmailClient("test-access-token", fetcher);

    const result = await client.searchListingAlerts({
      label: "Vera",
      allowedSenders: ["alerts@zillow.com"],
      subjectTerms: ["New listing"],
      afterHistoryId: null,
      maxResults: 10
    });

    const searchUrl = new URL(calls[0] as string);
    expect(searchUrl.searchParams.get("q")).toContain("label:Vera");
    expect(searchUrl.searchParams.get("q")).toContain("from:alerts@zillow.com");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("/users/me/messages/message-1?format=full");
    expect(JSON.stringify(calls)).not.toMatch(/messages\.send|drafts\.send|gmail\.modify|smtp/iu);
    expect(result).toMatchObject({ latestHistoryId: "22", messages: [{ messageId: "message-1" }] });
  });

  it("fails visibly on revoked authorization instead of returning an empty mailbox", async () => {
    const client = new GoogleGmailClient("test-access-token", async () => ({
      ok: false,
      status: 401,
      async json() {
        return {};
      }
    }));

    await expect(
      client.searchListingAlerts({
        label: "Vera",
        allowedSenders: [],
        subjectTerms: [],
        afterHistoryId: null,
        maxResults: 10
      })
    ).rejects.toMatchObject({ code: "gmail_authentication", retryable: false });
  });

  it("times out a stalled Gmail request without exposing the request", async () => {
    vi.useFakeTimers();
    const fetcher: GmailFetch = vi.fn(
      async (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
    );
    const client = new GoogleGmailClient("test-access-token", fetcher, {
      timeoutMilliseconds: 1_000
    });

    const pending = expect(
      client.searchListingAlerts({
        label: "Vera",
        allowedSenders: [],
        subjectTerms: [],
        afterHistoryId: null,
        maxResults: 10
      })
    ).rejects.toMatchObject({ code: "gmail_timeout", retryable: true });

    await vi.advanceTimersByTimeAsync(1_001);
    await pending;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("honors caller cancellation before its local deadline", async () => {
    const fetcher: GmailFetch = vi.fn(
      async (_url, init) =>
        new Promise<never>((_resolve, reject) => {
          if (init.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        })
    );
    const client = new GoogleGmailClient("test-access-token", fetcher, {
      timeoutMilliseconds: 10_000
    });
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(
      client.searchListingAlerts(
        {
          label: "Vera",
          allowedSenders: [],
          subjectTerms: [],
          afterHistoryId: null,
          maxResults: 10
        },
        controller.signal
      )
    ).rejects.toMatchObject({ code: "gmail_cancelled", retryable: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
