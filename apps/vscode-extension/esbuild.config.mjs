import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  sourcemap: watch ? "inline" : false,
  outfile: "out/extension.js",
  external: ["vscode", "better-sqlite3", "naudiodon"],
  logLevel: "info",
};

if (watch)
{
  const ctx = await context(options);
  await ctx.watch();
}
else
{
  await build(options);
}
