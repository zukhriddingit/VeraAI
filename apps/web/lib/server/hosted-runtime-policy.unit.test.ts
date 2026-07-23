import { describe, expect, it } from "vitest";

import { parseHostedRuntimePolicy } from "./hosted-runtime-policy.ts";

describe("hosted runtime policy", () => {
  it("fails closed when external capabilities are unset", () => {
    expect(parseHostedRuntimePolicy({})).toEqual({
      browserDisabled: true,
      gmailAlertsDisabled: true,
      integrationsDisabled: true,
      notificationsDisabled: true
    });
  });

  it("accepts only explicit Boolean spellings", () => {
    expect(
      parseHostedRuntimePolicy({
        VERA_BROWSER_DISABLED: "false",
        VERA_GMAIL_ALERTS_DISABLED: "0",
        VERA_INTEGRATIONS_DISABLED: "true",
        VERA_NOTIFICATIONS_DISABLED: "1"
      })
    ).toEqual({
      browserDisabled: false,
      gmailAlertsDisabled: false,
      integrationsDisabled: true,
      notificationsDisabled: true
    });
    expect(() => parseHostedRuntimePolicy({ VERA_BROWSER_DISABLED: "maybe" })).toThrow(
      /VERA_BROWSER_DISABLED/u
    );
  });
});
