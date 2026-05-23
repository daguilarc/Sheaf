# Issue responses

## Response POL-0001 2026-05-23T21:34:44Z

- issue_id: POL-0001
- outcome: Fixed
- explanation: Added `better-sqlite3` (`^12.10.0`) and `naudiodon` (`^2.3.6`) to the
  runtime `dependencies` block in `apps/vscode-extension/package.json` so the
  externalized requires in the bundled `out/extension.js` can be resolved from
  `apps/vscode-extension/node_modules` at runtime. Ran `npm install` in
  `apps/vscode-extension`, which now installs both native packages (and their native
  binaries via prebuild-install) plus refreshes `package-lock.json`. Verified
  resolution by using `Module.createRequire` rooted at
  `apps/vscode-extension/out/extension.js` to resolve both `better-sqlite3` and
  `naudiodon` — both resolve into `apps/vscode-extension/node_modules`. `npm run
  build` still produces `out/extension.js`, and `npm test` still passes (6/6). The
  README already documents rebuilding native modules against VS Code's Electron ABI
  in the "Native modules" section, so no doc change was required.

## Response POL-0002 2026-05-23T21:34:44Z

- issue_id: POL-0002
- outcome: Fixed
- explanation: Rewrote `apps/vscode-extension/esbuild.config.mjs` to use esbuild's
  supported watch API: in `--watch` mode it now calls `context(options)` followed by
  `ctx.watch()` instead of passing the unsupported `watch: true` build option. The
  one-shot `build` path still calls `build(options)` with the same configuration
  (same entry points, externals, sourcemap behavior, target, etc.), so `npm run
  build` continues to produce `out/extension.js`. Verified `npm run dev` now starts
  watch mode cleanly and prints `[watch] build finished, watching for changes...`
  instead of failing with `Invalid option in build() call: "watch"`. `npm test`
  still passes (6/6).
