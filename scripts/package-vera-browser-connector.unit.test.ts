import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";

import { CONNECTOR_PACKAGE_ENTRIES, packageVeraBrowserConnector } from "./package-vera-browser-connector.ts";

it("creates identical allowlisted package bytes", async () => {
  const first = await mkdtemp(join(tmpdir(), "vera-package-a-"));
  const second = await mkdtemp(join(tmpdir(), "vera-package-b-"));
  const sourceDirectory = resolve("infra/chrome/vera-openclaw-extension");
  const a = await packageVeraBrowserConnector({ sourceDirectory, outputDirectory: first });
  const b = await packageVeraBrowserConnector({ sourceDirectory, outputDirectory: second });
  expect(a.sha256).toBe(b.sha256);
  expect(a.entries).toEqual(CONNECTOR_PACKAGE_ENTRIES);
  expect(a.entries.some((entry) => /test|store|\.ts$/u.test(entry))).toBe(false);
});
