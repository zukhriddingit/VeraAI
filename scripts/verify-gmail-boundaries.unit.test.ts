import { describe, expect, it } from "vitest";

import { findGmailBoundaryViolations } from "./verify-gmail-boundaries.ts";

describe("Gmail readonly production boundary verifier", () => {
  it.each([
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://mail.google.com/",
    "gmail.users.drafts.create",
    "gmail.users.drafts.send",
    "gmail.users.messages.send",
    "/gmail/v1/users/me/drafts/send",
    "/gmail/v1/users/me/messages/send"
  ])("rejects forbidden Gmail capability %s", (source) => {
    expect(findGmailBoundaryViolations(new Map([["production.ts", source]]))).toHaveLength(1);
  });

  it("allows the exact readonly scope and GET list/detail endpoints", () => {
    expect(
      findGmailBoundaryViolations(
        new Map([
          [
            "production.ts",
            'const scope = "https://www.googleapis.com/auth/gmail.readonly"; const method = "GET"; const endpoint = "/gmail/v1/users/me/messages";'
          ]
        ])
      )
    ).toEqual([]);
  });

  it("reports each file and rule without copying source content", () => {
    expect(
      findGmailBoundaryViolations(
        new Map([
          ["apps/web/unsafe.ts", 'const scope = "https://mail.google.com/";'],
          ["apps/worker/unsafe.ts", "gmail.users.messages.send({});"]
        ])
      )
    ).toEqual([
      { file: "apps/web/unsafe.ts", rule: "broad_scope" },
      { file: "apps/worker/unsafe.ts", rule: "send_or_draft_operation" }
    ]);
  });
});
