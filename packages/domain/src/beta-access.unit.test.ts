import { describe, expect, it } from "vitest";

import {
  BETA_CONSENT_VERSION,
  BetaAccessAcceptedResponseSchema,
  BetaAccessSubmissionSchema,
  normalizeBetaEmail
} from "./beta-access.ts";

describe("beta access contracts", () => {
  it("normalizes an email before validating it", () => {
    expect(normalizeBetaEmail("  TESTER＠EXAMPLE.COM  ")).toBe("tester@example.com");
  });

  it("requires current consent and an empty honeypot", () => {
    expect(
      BetaAccessSubmissionSchema.parse({
        email: "tester@example.com",
        consent: true,
        consentVersion: BETA_CONSENT_VERSION,
        website: ""
      }).email
    ).toBe("tester@example.com");

    expect(() =>
      BetaAccessSubmissionSchema.parse({
        email: "tester@example.com",
        consent: false,
        consentVersion: BETA_CONSENT_VERSION,
        website: ""
      })
    ).toThrow();
    expect(() =>
      BetaAccessSubmissionSchema.parse({
        email: "tester@example.com",
        consent: true,
        consentVersion: BETA_CONSENT_VERSION,
        website: "bot"
      })
    ).toThrow();
  });

  it("has one enumeration-resistant accepted response", () => {
    expect(
      BetaAccessAcceptedResponseSchema.parse({ accepted: true, code: "request_received" })
    ).toEqual({ accepted: true, code: "request_received" });
  });
});
