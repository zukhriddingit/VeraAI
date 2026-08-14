import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { expect, it } from "vitest";

import { CONNECTOR_ICON_SIZES, generateConnectorIcons } from "./generate-vera-connector-assets.ts";

it("generates four exact PNG sizes reproducibly", async () => {
  const first = await mkdtemp(join(tmpdir(), "vera-icons-a-"));
  const second = await mkdtemp(join(tmpdir(), "vera-icons-b-"));
  const source = "infra/chrome/vera-openclaw-extension/assets/vera-connector-icon.svg";
  await generateConnectorIcons(source, first);
  await generateConnectorIcons(source, second);
  for (const size of CONNECTOR_ICON_SIZES) {
    const a = await readFile(join(first, `icon-${size}.png`));
    const b = await readFile(join(second, `icon-${size}.png`));
    expect(a).toEqual(b);
    expect(await sharp(a).metadata()).toMatchObject({ width: size, height: size, format: "png" });
  }
});
