import { describe, expect, it, vi } from "vitest";

import { resetLocalPostgres, validateLocalPostgresReset } from "./postgres-reset.ts";

describe("guarded local PostgreSQL reset", () => {
  it("rejects production, remote hosts, and unexpected database identities", () => {
    expect(() =>
      validateLocalPostgresReset({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://vera:x@127.0.0.1:5432/vera"
      })
    ).toThrow(/production/u);
    expect(() =>
      validateLocalPostgresReset({ DATABASE_URL: "postgresql://vera:x@db.example/vera" })
    ).toThrow(/loopback/u);
    expect(() =>
      validateLocalPostgresReset({ DATABASE_URL: "postgresql://admin:x@127.0.0.1/other" })
    ).toThrow(/local vera/u);
  });

  it("requires the exact Compose project before destructive commands", () => {
    const runner = vi.fn(() => '{"Service":"postgres","Project":"other"}');
    expect(() =>
      resetLocalPostgres({ DATABASE_URL: "postgresql://vera:x@127.0.0.1:5432/vera" }, runner)
    ).toThrow(/expected Vera Compose/u);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("resets only after validation", () => {
    const runner = vi.fn((args: readonly string[]) =>
      args.includes("ps") ? '{"Service":"postgres","Project":"vera"}' : ""
    );
    resetLocalPostgres({ DATABASE_URL: "postgresql://vera:x@localhost:5432/vera" }, runner);
    expect(runner.mock.calls.map(([args]) => args)).toEqual([
      ["compose", "ps", "--format", "json", "postgres"],
      ["compose", "down", "--volumes"],
      ["compose", "up", "-d", "postgres"]
    ]);
  });
});
