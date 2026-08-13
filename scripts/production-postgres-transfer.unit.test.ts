import { describe, expect, it } from "vitest";

import {
  connectionEnvironment,
  filteredRestoreList,
  privateEvidencePath,
  redactedDatabaseLabel,
  restoreArguments,
  restoreTargetIsEmpty
} from "./production-postgres-transfer.ts";

describe("production PostgreSQL transfer safety", () => {
  it("accepts the standard postgres URI emitted by Heroku", () => {
    expect(connectionEnvironment("postgres://vera:secret@db.example.test:5432/vera", {})).toEqual({
      PGDATABASE: "vera",
      PGHOST: "db.example.test",
      PGPASSWORD: "secret",
      PGPORT: "5432",
      PGSSLMODE: "require",
      PGUSER: "vera"
    });
  });

  it("keeps credentials out of subprocess arguments and diagnostics", () => {
    const url =
      "postgresql://vera:synthetic-secret@db.example.test:5432/vera?sslmode=require&application_name=vera-cutover";
    const environment = connectionEnvironment(url, {});

    expect(environment).toEqual({
      PGAPPNAME: "vera-cutover",
      PGDATABASE: "vera",
      PGHOST: "db.example.test",
      PGPASSWORD: "synthetic-secret",
      PGPORT: "5432",
      PGSSLMODE: "require",
      PGUSER: "vera"
    });
    expect(
      restoreArguments(
        "vera",
        "/private/tmp/vera/production.dump",
        "/private/tmp/vera/toc.list"
      ).join(" ")
    ).not.toContain("synthetic-secret");
    expect(redactedDatabaseLabel(url)).toBe("db.example.test:5432/vera");
  });

  it("maps a verified root certificate without copying compatibility flags", () => {
    expect(
      connectionEnvironment(
        "postgresql://vera:secret@db.example.test/vera?sslmode=verify-ca&sslrootcert=%2Fsecure%2Froot.crt&uselibpqcompat=true",
        {}
      )
    ).toMatchObject({
      PGSSLMODE: "verify-ca",
      PGSSLROOTCERT: "/secure/root.crt"
    });
  });

  it("permits disabled PostgreSQL TLS only through a loopback SSH tunnel", () => {
    expect(
      connectionEnvironment("postgresql://vera:secret@127.0.0.1:15432/vera?sslmode=disable", {})
    ).toMatchObject({ PGHOST: "127.0.0.1", PGSSLMODE: "disable" });
    expect(() =>
      connectionEnvironment("postgresql://vera:secret@db.example.test/vera?sslmode=disable", {})
    ).toThrow("only permitted through loopback");
  });

  it.each([
    "postgresql://vera:secret@db.example.test/vera?connect_timeout=0",
    "postgresql://vera:secret@db.example.test/vera?sslmode=prefer",
    "https://vera:secret@db.example.test/vera"
  ])("rejects an unsafe connection URL: %s", (url) => {
    expect(() => connectionEnvironment(url, {})).toThrow();
  });

  it.each(["relative.dump", "/Users/example/production.dump", "/tmp/not-private.dump"])(
    "rejects a non-private path: %s",
    (path) => expect(() => privateEvidencePath(path)).toThrow("private evidence")
  );

  it("accepts the authoritative private evidence root", () => {
    expect(privateEvidencePath("/private/tmp/vera/production.dump")).toBe(
      "/private/tmp/vera/production.dump"
    );
  });

  it("restores without clean, create, owner, or ACL mutations", () => {
    const arguments_ = restoreArguments(
      "vera",
      "/private/tmp/vera/production.dump",
      "/private/tmp/vera/toc.list"
    );
    expect(arguments_).toEqual([
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--use-list",
      "/private/tmp/vera/toc.list",
      "--dbname",
      "vera",
      "/private/tmp/vera/production.dump"
    ]);
    expect(arguments_.join(" ")).not.toMatch(/--clean|--create|--role/iu);
  });

  it("omits only the archive public-schema definition", () => {
    const restoreList = [
      "; archive header",
      "6; 2615 16385 SCHEMA - drizzle vera",
      "4; 2615 2200 SCHEMA - public pg_database_owner",
      "4366; 0 0 COMMENT - SCHEMA public pg_database_owner",
      "222; 1259 16397 TABLE public accounts vera"
    ].join("\n");
    const filtered = filteredRestoreList(restoreList);

    expect(filtered).not.toContain("SCHEMA - public");
    expect(filtered).toContain("SCHEMA - drizzle");
    expect(filtered).toContain("COMMENT - SCHEMA public");
    expect(filtered).toContain("TABLE public accounts");
  });

  it.each([
    "6; 2615 16385 SCHEMA - drizzle vera",
    [
      "6; 2615 16385 SCHEMA - drizzle vera",
      "4; 2615 2200 SCHEMA - public pg_database_owner",
      "5; 2615 2201 SCHEMA - shadow vera"
    ].join("\n")
  ])("rejects an unexpected archive schema set", (restoreList) => {
    expect(() => filteredRestoreList(restoreList)).toThrow("schema definitions are unexpected");
  });

  it("accepts only PostgreSQL's default and Heroku-managed empty schemas", () => {
    expect(restoreTargetIsEmpty({ schemaNames: ["public"], tableCount: 0 })).toBe(true);
    expect(restoreTargetIsEmpty({ schemaNames: "{public}", tableCount: "0" })).toBe(true);
    expect(restoreTargetIsEmpty({ schemaNames: ["_heroku", "public"], tableCount: 0 })).toBe(true);
    expect(restoreTargetIsEmpty({ schemaNames: "{_heroku,public}", tableCount: "0" })).toBe(true);
    expect(restoreTargetIsEmpty({ schemaNames: ["drizzle", "public"], tableCount: 0 })).toBe(false);
    expect(restoreTargetIsEmpty({ schemaNames: ["public"], tableCount: 1 })).toBe(false);
    expect(restoreTargetIsEmpty({ schemaNames: ["_heroku", "public"], tableCount: 1 })).toBe(false);
  });

  it.each(["vera;drop database vera", "vera/name", ""])(
    "rejects an unsafe database name: %s",
    (databaseName) =>
      expect(() =>
        restoreArguments(
          databaseName,
          "/private/tmp/vera/production.dump",
          "/private/tmp/vera/toc.list"
        )
      ).toThrow("database name")
  );
});
