import { describe, expect, it } from "vitest";

import { PushSubscriptionDataSchema } from "./contracts.ts";
import { createWebPushNotificationProvider } from "./web-push-provider.ts";

const ready =
  process.env.VERA_WEB_PUSH_STAGING_TEST === "1" &&
  Boolean(process.env.VERA_WEB_PUSH_STAGING_SUBSCRIPTION_JSON?.trim()) &&
  Boolean(process.env.NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY?.trim()) &&
  Boolean(process.env.VERA_VAPID_PRIVATE_KEY?.trim()) &&
  Boolean(process.env.VERA_VAPID_SUBJECT?.trim());

describe.skipIf(!ready)("Web Push staging smoke", () => {
  it("sends only Vera's fixed generic test notification", async () => {
    const provider = createWebPushNotificationProvider({
      subject: process.env.VERA_VAPID_SUBJECT!,
      publicKey: process.env.NEXT_PUBLIC_VERA_VAPID_PUBLIC_KEY!,
      privateKey: process.env.VERA_VAPID_PRIVATE_KEY!
    });
    const result = await provider.send({
      subscription: PushSubscriptionDataSchema.parse(
        JSON.parse(process.env.VERA_WEB_PUSH_STAGING_SUBSCRIPTION_JSON!) as unknown
      ),
      payload: {
        title: "Vera found a new match",
        body: "Open Vera to review a new listing.",
        deepLink: "/listings/staging-smoke"
      }
    });
    expect(["delivered", "revoked", "retryable_failed", "permanently_failed"]).toContain(
      result.status
    );
  });
});
