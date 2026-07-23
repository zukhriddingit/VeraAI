import { describe, expect, it } from "vitest";

import { notificationSettingsView } from "./notification-settings.tsx";

describe("notification settings", () => {
  it("requires an explicit user action and describes generic lock-screen copy", () => {
    expect(notificationSettingsView(true, 0)).toEqual({
      configured: true,
      activeSubscriptionCount: 0,
      permissionRequestedAutomatically: false,
      lockScreenDisclosure:
        "Lock-screen notifications are generic and omit address, price, description, risk evidence, and contact details."
    });
  });
});
