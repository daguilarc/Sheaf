import { build } from "esbuild";

const watch = process.argv.includes("--watch");

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  sourcemap: watch ? "inline" : false,
  outfile: "out/extension.js",
  external: ["vscode", "better-sqlite3", "naudiodon"],
  logLevel: "info",
  ...(watch ? { watch: true } : {}),
});
