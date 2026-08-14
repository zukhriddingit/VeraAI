import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

export const CONNECTOR_ICON_SIZES = [16, 32, 48, 128] as const;

export async function generateConnectorIcons(
  sourceSvg: string,
  outputDirectory: string
): Promise<void> {
  const source = await readFile(sourceSvg);
  await mkdir(outputDirectory, { recursive: true });
  for (const size of CONNECTOR_ICON_SIZES) {
    const png = await sharp(source, { density: 384 })
      .resize(size, size, { fit: "fill" })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    await writeFile(join(outputDirectory, `icon-${size}.png`), png);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) throw new Error("Usage: generate-vera-connector-assets <output-directory>");
  await generateConnectorIcons(
    "infra/chrome/vera-openclaw-extension/assets/vera-connector-icon.svg",
    outputDirectory
  );
}
