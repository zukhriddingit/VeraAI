import { describe, expect, it, vi } from "vitest";
import { WebPushNotificationProvider } from "./web-push-provider.ts";

const subscription = {
  endpoint: "https://push.example.test/subscription",
  expirationTime: null,
  keys: { p256dh: "public-key", auth: "auth-key" }
};
const payload = {
  title: "Vera found a new match" as const,
  body: "Open Vera to review a new listing." as const,
  deepLink: "/listings/listing-1"
};

describe("Web Push provider", () => {
  it("sends only the strict generic payload", async () => {
    const sendNotification = vi.fn(
      async (_subscription: typeof subscription, _payload: string) => ({
        statusCode: 201,
        headers: {}
      })
    );
    const boundary = {
      setVapidDetails: vi.fn(),
      sendNotification
    };
    const provider = new WebPushNotificationProvider(boundary, {
      subject: "mailto:security@example.test",
      publicKey: "public",
      privateKey: "private"
    });
    await expect(provider.send({ subscription, payload })).resolves.toMatchObject({
      status: "delivered"
    });
    expect(JSON.parse(sendNotification.mock.calls[0]?.[1] ?? "{}")).toEqual(payload);
  });

  it("maps revoked and transient failures without returning provider bodies", async () => {
    const sendNotification = vi.fn(async (_subscription: typeof subscription, _payload: string) => {
      throw Object.assign(new Error("private provider body"), { statusCode: 410 });
    });
    const boundary = {
      setVapidDetails: vi.fn(),
      sendNotification
    };
    const provider = new WebPushNotificationProvider(boundary, {
      subject: "mailto:security@example.test",
      publicKey: "public",
      privateKey: "private"
    });
    await expect(provider.send({ subscription, payload })).resolves.toEqual({
      status: "revoked",
      safeErrorCode: "push_subscription_revoked"
    });
  });
});
