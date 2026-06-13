import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  sourcemap: watch ? "inline" : false,
  outfile: "out/extension.cjs",
  external: ["vscode"],
  logLevel: "info",
};

if (watch)
{
  const extensionContext = await context(extensionOptions);
  await extensionContext.watch();
}
else
{
  await build(extensionOptions);
}
