import { build } from "esbuild";

await build({
  banner: {
    js: "import { createRequire as __veraCreateRequire } from 'node:module'; const require = __veraCreateRequire(import.meta.url);"
  },
  bundle: true,
  entryPoints: ["src/index.ts"],
  // Keep native and CommonJS runtime dependencies in the production node_modules tree.
  // Bundling pg into ESM rewrites its dynamic Node built-in requires and crashes before
  // even the dependency-free health command can run.
  external: ["better-sqlite3", "pg", "pino", "sharp"],
  format: "esm",
  logLevel: "info",
  outfile: "dist/index.js",
  platform: "node",
  sourcemap: true,
  target: "node24"
});
