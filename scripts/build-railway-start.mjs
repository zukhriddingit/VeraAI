import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: ["scripts/railway-start.ts"],
  external: ["better-sqlite3"],
  format: "esm",
  logLevel: "info",
  outfile: "dist/railway-start.mjs",
  platform: "node",
  sourcemap: true,
  target: "node24"
});
