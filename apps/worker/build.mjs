import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: ["better-sqlite3", "pino"],
  format: "esm",
  logLevel: "info",
  outfile: "dist/index.js",
  platform: "node",
  sourcemap: true,
  target: "node24"
});
