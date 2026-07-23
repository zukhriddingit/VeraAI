import { describe, expect, it } from "vitest";

import { sanitizeLogValue } from "./log-sanitizer.ts";

describe("sanitizeLogValue", () => {
  it("redacts sensitive keys and contact-shaped values at arbitrary nesting", () => {
    const input = {
      provider: {
        attempts: [
          {
            authorization: "Bearer secret",
            payload: {
              email: "person@example.test",
              phone: "+1 617 555 1212",
              safeCode: "gmail_timeout"
            }
          }
        ]
      }
    };

    const serialized = JSON.stringify(sanitizeLogValue(input));
    expect(serialized).toContain("gmail_timeout");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("person@example.test");
    expect(serialized).not.toContain("617 555 1212");
  });

  it("preserves safe ISO timestamps while redacting phone-shaped strings", () => {
    expect(
      sanitizeLogValue({
        occurredAt: "2026-07-22T18:59:06.862Z",
        detail: "Call +1 (617) 555-1212"
      })
    ).toEqual({
      occurredAt: "2026-07-22T18:59:06.862Z",
      detail: "[REDACTED]"
    });
  });

  it("bounds cycles, depth, strings, arrays, object entries, and unsafe URL components", () => {
    const cyclic: Record<string, unknown> = {
      safeCode: "worker_error",
      diagnosticUrl: "https://logs.example.test/run/123?token=secret#private",
      oversized: "x".repeat(200),
      items: Array.from({ length: 10 }, (_, index) => index),
      entries: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`key${index}`, index]))
    };
    cyclic.self = cyclic;
    cyclic.child = { grandchild: { leaf: "hidden by depth" } };

    const sanitized = sanitizeLogValue(cyclic, {
      maxDepth: 1,
      maxStringLength: 80,
      maxArrayEntries: 2,
      maxObjectEntries: 10
    });
    const serialized = JSON.stringify(sanitized);

    expect(() => JSON.stringify(sanitized)).not.toThrow();
    expect(serialized).toContain("[CIRCULAR]");
    expect(serialized).toContain("[TRUNCATED]");
    expect(serialized).toContain("https://logs.example.test/run/123");
    expect(serialized).not.toContain("token=secret");
    expect((sanitized as { items: unknown[] }).items).toHaveLength(2);
  });
});
