"use client";

import type { NotificationPreference } from "@vera/domain";
import { useState } from "react";

export interface NotificationSettingsView {
  readonly configured: boolean;
  readonly activeSubscriptionCount: number;
  readonly permissionRequestedAutomatically: false;
  readonly lockScreenDisclosure: string;
}

export function notificationSettingsView(
  configured: boolean,
  activeSubscriptionCount: number
): NotificationSettingsView {
  return {
    configured,
    activeSubscriptionCount,
    permissionRequestedAutomatically: false,
    lockScreenDisclosure:
      "Lock-screen notifications are generic and omit address, price, description, risk evidence, and contact details."
  };
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = atob((value + padding).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function NotificationSettings(props: {
  readonly publicVapidKey: string | null;
  readonly initialPreference: NotificationPreference;
  readonly activeSubscriptionCount: number;
}) {
  const [preference, setPreference] = useState(props.initialPreference);
  const [subscribed, setSubscribed] = useState(props.activeSubscriptionCount > 0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const view = notificationSettingsView(
    props.publicVapidKey !== null,
    props.activeSubscriptionCount
  );

  async function subscribe(): Promise<void> {
    if (!props.publicVapidKey) return;
    setPending(true);
    setMessage(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("This browser does not support Web Push.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.register("/vera-push-sw.js", {
        scope: "/"
      });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(props.publicVapidKey)
      });
      const response = await fetch("/api/notifications/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON())
      });
      if (!response.ok) throw new Error("Vera could not save this browser subscription.");
      setSubscribed(true);
      setMessage("Notifications enabled for this browser.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Notifications could not be enabled.");
    } finally {
      setPending(false);
    }
  }

  async function unsubscribe(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/notifications/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        if (!response.ok) throw new Error("Vera could not disable this browser subscription.");
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage("Notifications disabled for this browser.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Notifications could not be disabled.");
    } finally {
      setPending(false);
    }
  }

  async function savePreference(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const {
        userId: _userId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...update
      } = preference;
      const response = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update)
      });
      const body = (await response.json()) as { preference?: NotificationPreference };
      if (!response.ok || !body.preference)
        throw new Error("Notification preferences could not be saved.");
      setPreference(body.preference);
      setMessage("Notification preferences saved.");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Notification preferences could not be saved."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-section">
      <article className="integration-card">
        <div className="integration-card-heading">
          <div>
            <p className="eyebrow">Founder notification channel</p>
            <h2>Browser notifications</h2>
          </div>
          <span
            className={`capability-state capability-state-${subscribed ? "granted" : "disconnected"}`}
          >
            {subscribed ? "Enabled" : view.configured ? "Not enabled" : "Unavailable"}
          </span>
        </div>
        <p>{view.lockScreenDisclosure}</p>
        <p className="integration-disclosure">
          Permission is requested only after you press Enable. Vera never uses your Gmail mailbox as
          an outbound notification transport.
        </p>
        {subscribed ? (
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={pending}
            onClick={() => void unsubscribe()}
          >
            Disable this browser
          </button>
        ) : (
          <button
            className="primary-button compact-button"
            type="button"
            disabled={pending || !view.configured}
            onClick={() => void subscribe()}
          >
            {pending ? "Working…" : "Enable browser notifications"}
          </button>
        )}
      </article>

      <article className="integration-card">
        <h2>Match rules</h2>
        <label>
          Minimum fit score
          <input
            type="number"
            min="0"
            max="100"
            value={preference.scoreThreshold}
            onChange={(event) =>
              setPreference({ ...preference, scoreThreshold: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Only listings observed within (minutes)
          <input
            type="number"
            min="1"
            max="43200"
            value={preference.freshnessMinutes}
            onChange={(event) =>
              setPreference({ ...preference, freshnessMinutes: Number(event.target.value) })
            }
          />
        </label>
        <label>
          Quiet hours start
          <input
            type="time"
            value={preference.quietHoursStart}
            onChange={(event) =>
              setPreference({ ...preference, quietHoursStart: event.target.value })
            }
          />
        </label>
        <label>
          Quiet hours end
          <input
            type="time"
            value={preference.quietHoursEnd}
            onChange={(event) =>
              setPreference({ ...preference, quietHoursEnd: event.target.value })
            }
          />
        </label>
        <label>
          Timezone
          <input
            type="text"
            value={preference.timezone}
            onChange={(event) => setPreference({ ...preference, timezone: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={preference.digestEnabled}
            onChange={(event) =>
              setPreference({ ...preference, digestEnabled: event.target.checked })
            }
          />
          Use a digest when immediate delivery is deferred
        </label>
        <button
          className="primary-button compact-button"
          type="button"
          disabled={pending}
          onClick={() => void savePreference()}
        >
          Save notification rules
        </button>
      </article>
      {message ? (
        <p className="settings-error" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
