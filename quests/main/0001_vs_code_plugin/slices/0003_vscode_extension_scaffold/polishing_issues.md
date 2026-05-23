# Issues

## Issue POL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-05-23T21:32:40Z
- updated_at: 2026-05-23T21:35:56Z
- title: Extension bundle cannot resolve external native runtime dependencies
- details: `apps/vscode-extension/esbuild.config.mjs` bundles `realtime-agent-lib` but externalizes `better-sqlite3` and `naudiodon`, so the generated `out/extension.js` contains `require("better-sqlite3")` and `require("naudiodon")`. Those packages are not installed under `apps/vscode-extension/node_modules`; `npm install` created only a symlinked `realtime-agent-lib` plus dev dependencies. Runtime resolution from `apps/vscode-extension/out` therefore fails with `MODULE_NOT_FOUND` for both native modules before the extension can open the database or microphone. This violates the physical plan requirement that native modules remain external and be resolved at runtime from the extension's `node_modules`, and it blocks the manual smoke path in a VS Code Extension Development Host.

  To mark this completed, the extension package must install and lock the runtime packages needed by the externalized requires (at minimum `better-sqlite3` and `naudiodon`, plus any other non-bundled runtime dependency if added), and the built extension must be able to resolve those modules from `apps/vscode-extension/out`. The package/README guidance should still cover rebuilding native modules for VS Code's Electron ABI.
- resolution_notes: Verified `apps/vscode-extension/package.json` and `package-lock.json` now declare and lock `better-sqlite3` and `naudiodon` as extension runtime dependencies. Verified both packages are present under `apps/vscode-extension/node_modules`, and `Module.createRequire` rooted at `apps/vscode-extension/out/extension.js` resolves both externalized requires into the extension package.

## Issue POL-0002

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-05-23T21:32:40Z
- updated_at: 2026-05-23T21:35:56Z
- title: VS Code extension dev script fails with current esbuild API
- details: `apps/vscode-extension/package.json` declares `dev: node esbuild.config.mjs --watch`, but `apps/vscode-extension/esbuild.config.mjs` passes `watch: true` into `build()`. With the locked esbuild 0.24.2 API this is an invalid build option, and invoking the script fails immediately with `Invalid option in build() call: "watch"`. The physical plan required a working esbuild build pipeline mirroring `apps/obsidian-replica`, including a watch/dev script, so this is an incomplete scaffold.

  To mark this completed, the dev script must use the supported esbuild context/watch API, or another working watch implementation, while keeping the normal `build` script working.
- resolution_notes: Verified `apps/vscode-extension/esbuild.config.mjs` now uses esbuild's supported `context(options)` plus `ctx.watch()` path for `--watch`, while the one-shot path still calls `build(options)` without the invalid `watch` option.
