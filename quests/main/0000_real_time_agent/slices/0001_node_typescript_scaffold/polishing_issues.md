# Issues

## Issue SP-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-05-22T20:00:00Z
- updated_at: 2026-05-23T01:50:00Z
- title: Package entry points reference nonexistent paths
- details: `package.json` declares `main` as `./dist/index.js`, `types` as `./dist/index.d.ts`, and `exports["."]` pointing to those same paths. However, `tsconfig.json` sets `rootDir: "."` with `include: ["src/**/*.ts", "test/**/*.ts"]`, which causes TypeScript to compile `src/index.ts` to `dist/src/index.js` (preserving the `src/` directory segment). The file `dist/index.js` does not exist after a build — verified by inspecting the actual `dist/` output. External consumers importing `realtime-agent-lib` would receive a module-not-found error. The `bin` field already correctly uses `./dist/src/cli.js`, making the inconsistency visible. The existing test does not catch this because it uses a relative import (`../src/index.js`) rather than resolving through the package entry point.
- resolution_notes: Fixed. Entry points updated to `./dist/src/index.js` and `./dist/src/index.d.ts`. A regression test now verifies all declared entry point files exist after build and that the package is dynamically importable by name.
