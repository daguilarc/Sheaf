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
  outfile: "out/extension.js",
  external: ["vscode", "better-sqlite3", "naudiodon"],
  logLevel: "info",
};

const webviewOptions = {
  entryPoints: ["src/chat/webview/index.ts"],
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
  copyFileSync(join(rootDir, "src", "chat", "webview", "index.css"), join(rootDir, "out", "webview", "index.css"));
}

if (watch)
{
  const ctxExt = await context(extensionOptions);
  const ctxWeb = await context(webviewOptions);
  CopyWebviewStyles();
  await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
}
else
{
  await Promise.all([build(extensionOptions), build(webviewOptions)]);
  CopyWebviewStyles();
}
