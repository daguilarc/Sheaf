import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const rootDir = dirname(fileURLToPath(import.meta.url));

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

const webviewOptions = {
  entryPoints: ["src/webview/index.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: watch ? "inline" : false,
  outfile: "out/webview/index.js",
  logLevel: "info",
};

function CopyWebviewStyles()
{
  mkdirSync(join(rootDir, "out", "webview"), { recursive: true });
  copyFileSync(join(rootDir, "src", "webview", "index.css"), join(rootDir, "out", "webview", "index.css"));
}

if (watch)
{
  const extensionContext = await context(extensionOptions);
  const webviewContext = await context(webviewOptions);
  CopyWebviewStyles();
  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
}
else
{
  await Promise.all([build(extensionOptions), build(webviewOptions)]);
  CopyWebviewStyles();
}
