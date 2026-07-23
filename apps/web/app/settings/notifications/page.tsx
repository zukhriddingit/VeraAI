import Link from "next/link";

import { NotificationPreferenceSchema } from "@vera/domain";

import { getHostedApplication } from "../../../lib/server/application.ts";
import { parseNotificationEnvironment } from "../../../lib/server/notification-config.ts";
import { requireVeraPageSession } from "../../../lib/server/page-session.ts";
import { NotificationSettings } from "./notification-settings.tsx";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  const application = getHostedApplication();
  const context = await requireVeraPageSession();
  const now = new Date().toISOString();
  const configuration = application.mode === "hosted" ? parseNotificationEnvironment() : null;
  const existing =
    application.mode === "hosted" ? await context.repositories.notificationPreferences.get() : null;
  const preference =
    existing ??
    NotificationPreferenceSchema.parse({
      userId: context.userId,
      enabled: true,
      scoreThreshold: 75,
      freshnessMinutes: 120,
      riskCeiling: "medium",
      timezone: "America/New_York",
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      hourlyLimit: 6,
      digestEnabled: true,
      createdAt: now,
      updatedAt: now
    });
  const subscriptions =
    application.mode === "hosted" ? await context.repositories.webPushSubscriptions.list() : [];

  return (
    <main>
      <nav className="page-nav" aria-label="Vera navigation">
        <Link href="/">Listings</Link>
        <Link href="/settings/integrations">Integrations</Link>
        <Link href="/settings/notifications" aria-current="page">
          Notifications
        </Link>
      </nav>
      <header className="subpage-hero settings-hero">
        <p className="eyebrow">Settings · Notifications</p>
        <h1>Fast alerts, without private lock-screen details.</h1>
        <p className="lede">
          Vera applies deterministic fit, freshness, duplicate, and risk rules before queueing one
          idempotent notification.
        </p>
      </header>
      <NotificationSettings
        publicVapidKey={configuration?.publicVapidKey ?? null}
        initialPreference={preference}
        activeSubscriptionCount={
          subscriptions.filter((subscription) => subscription.status === "active").length
        }
      />
    </main>
  );
}
