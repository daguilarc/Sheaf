# Issue responses

## Response SP-0001 2026-05-23T01:48:07Z

- issue_id: SP-0001
- outcome: Fixed
- explanation: Updated `apps/realtime-agent/package.json` so `main`, `types`, and `exports["."]` point to the built `dist/src/index.js` and `dist/src/index.d.ts` files produced by the current `tsconfig.json`. Added a regression test in `apps/realtime-agent/test/exports.test.ts` that verifies the declared package entry files exist after build and dynamically imports the package by name through its configured exports.
