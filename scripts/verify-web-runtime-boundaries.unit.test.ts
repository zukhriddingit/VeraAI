import { describe, expect, it } from "vitest";

import {
  findWebDateRenderingViolations,
  findWebRuntimeBoundaryViolations
} from "./verify-web-runtime-boundaries.ts";

const applicationFile = "apps/web/lib/server/application.ts";
const runtimeFile = "apps/web/lib/server/google-integration-runtime.ts";

function files(file: string, source: string): ReadonlyMap<string, string> {
  return new Map([[file, source]]);
}

describe("web runtime boundary verifier", () => {
  it("accepts lightweight contracts, type-only imports, and the reviewed lazy imports", () => {
    expect(
      findWebRuntimeBoundaryViolations(
        new Map([
          [
            applicationFile,
            `
              import type { CalendarApplicationDependencies } from "./calendar-application.ts";
              import { CalendarProviderError } from "@vera/calendar/errors";
              import { GoogleIntegrationOAuthError } from "./google-integration-contracts.ts";
            `
          ],
          [
            runtimeFile,
            `
              import type { CalendarApplicationDependencies } from "./calendar-application.ts";
              import type { GmailIntegrationOAuth } from "./gmail-integration-oauth.ts";
              async function load() {
                return Promise.all([
                  import("./calendar-application.ts"),
                  import("./google-integration-oauth.ts"),
                  import("./gmail-integration-oauth.ts")
                ]);
              }
            `
          ]
        ])
      )
    ).toEqual([]);
  });

  it.each([
    ["Calendar package root", 'import { GoogleCalendarClient } from "@vera/calendar";'],
    ["googleapis", 'import { google } from "googleapis";'],
    ["google-auth-library", 'import { CodeChallengeMethod } from "google-auth-library";'],
    [
      "Calendar implementation",
      'import { createHostedCalendarApplication } from "./calendar-application.ts";'
    ],
    [
      "Calendar OAuth implementation",
      'import { createGoogleIntegrationOAuth } from "./google-integration-oauth.ts";'
    ],
    [
      "Gmail OAuth implementation",
      'import { createGmailIntegrationOAuth } from "./gmail-integration-oauth.ts";'
    ],
    [
      "mixed type and runtime import",
      'import { type GoogleIntegrationOAuth, createGoogleIntegrationOAuth } from "./google-integration-oauth.ts";'
    ]
  ])("rejects a static %s import", (_name, source) => {
    expect(findWebRuntimeBoundaryViolations(files(applicationFile, source))).toEqual([
      expect.objectContaining({
        file: applicationFile,
        message: "guarded web startup module must not statically load Google runtime code"
      })
    ]);
  });

  it("rejects runtime re-exports and require calls", () => {
    const violations = findWebRuntimeBoundaryViolations(
      files(
        applicationFile,
        `
          export { createGoogleIntegrationOAuth } from "./google-integration-oauth.ts";
          const provider = require("googleapis");
        `
      )
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: "./google-integration-oauth.ts",
          message: "guarded web startup module must not runtime-re-export Google code"
        }),
        expect.objectContaining({
          specifier: "googleapis",
          message: "guarded web startup module must not require Google runtime code"
        })
      ])
    );
  });

  it("rejects an approved dynamic import outside the lazy loader", () => {
    expect(
      findWebRuntimeBoundaryViolations(
        files(applicationFile, 'const provider = import("./google-integration-oauth.ts");')
      )
    ).toEqual([
      expect.objectContaining({
        specifier: "./google-integration-oauth.ts",
        message: "Google runtime dynamic imports are allowed only in the reviewed lazy loader"
      })
    ]);
  });
});

describe("web date rendering boundary verifier", () => {
  it("accepts shared formatters, explicit timezones, and number localization", () => {
    expect(
      findWebDateRenderingViolations(
        new Map([
          [
            "apps/web/app/card.tsx",
            `
              import { formatUtcDateTime } from "../../lib/display-time.ts";
              const observed = formatUtcDateTime(value);
              const local = new Intl.DateTimeFormat("en-US", {
                month: "short",
                timeZone: window.timeZone
              }).format(new Date(value));
              const rent = new Intl.NumberFormat("en-US").format(maximumRent);
            `
          ]
        ])
      )
    ).toEqual([]);
  });

  it("rejects Date locale methods and Intl date formatters without a timezone", () => {
    const violations = findWebDateRenderingViolations(
      new Map([
        ["apps/web/app/card.tsx", "new Date(value).toLocaleString()"],
        [
          "apps/web/app/card-2.tsx",
          `new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(value))`
        ]
      ])
    );

    expect(violations).toEqual([
      expect.objectContaining({
        file: "apps/web/app/card.tsx",
        message: expect.stringContaining("deterministic time formatter")
      }),
      expect.objectContaining({
        file: "apps/web/app/card-2.tsx",
        message: expect.stringContaining("explicit timeZone")
      })
    ]);
  });
});
