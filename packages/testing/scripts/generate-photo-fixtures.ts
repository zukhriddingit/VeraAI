import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../fixtures/photos");

function syntheticBuildingSvg(variant: "base" | "different"): string {
  if (variant === "different") {
    return `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="480" fill="#e8f1fa"/>
      <circle cx="160" cy="190" r="110" fill="#24567a"/>
      <path d="M320 410 L500 80 L620 410 Z" fill="#d49132"/>
      <rect x="420" y="210" width="55" height="120" fill="#fff6d9"/>
    </svg>`;
  }
  return `<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
    <rect width="640" height="480" fill="#dceaf2"/>
    <rect x="90" y="100" width="460" height="310" rx="8" fill="#52697a"/>
    <path d="M55 130 L320 35 L585 130 Z" fill="#8b4f3f"/>
    <rect x="145" y="165" width="80" height="90" fill="#f8df91"/>
    <rect x="280" y="165" width="80" height="90" fill="#f8df91"/>
    <rect x="415" y="165" width="80" height="90" fill="#f8df91"/>
    <rect x="280" y="285" width="80" height="125" fill="#273846"/>
  </svg>`;
}

async function writeFixtures(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const base = await sharp(Buffer.from(syntheticBuildingSvg("base")))
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  await sharp(base).toFile(resolve(outputDirectory, "synthetic-building-base.png"));
  await sharp(base)
    .resize(320, 240, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 6, adaptiveFiltering: false })
    .toFile(resolve(outputDirectory, "synthetic-building-transformed.png"));
  await sharp(Buffer.from(syntheticBuildingSvg("different")))
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(resolve(outputDirectory, "synthetic-building-different.png"));
}

await writeFixtures();
