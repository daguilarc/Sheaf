# Task 2 Report: Catalog Discovery and Launcher

## Status

Task 2 is implemented with strict RED-GREEN-REFACTOR coverage. The intended commit is
`feat(synth-browser): discover catalogs in generic launcher`.

The production browser root now boots catalog discovery instead of the direct WASM
module. The direct `installSynthBrowserApp` API and its focused runtime coverage remain
available for rollback and later Task 6 work. No OpenSpec checkbox was modified, per
the controller instruction.

## Implementation

### Catalog client

- Added `CatalogClient`, which fetches and validates the configured source list through
  Task 1's `parseCatalogSources` contract.
- Starts every catalog request concurrently and validates each successful response
  through Task 1's `parseCatalog` contract.
- Merges accepted catalogs through Task 1's `mergeCatalogs` contract; validation and
  deterministic duplicate precedence are not duplicated in the client.
- Returns frozen accepted apps, one ordered diagnostic per configured source, and the
  merge's structured duplicate diagnostics.
- Distinguishes `loaded`, `network-error`, and `incompatible` source states without
  dropping healthy sibling catalogs.
- Uses normal cache handling (`cache: "default"`) at startup and explicit revalidation
  (`cache: "no-cache"`) for a stable-URL retry.
- Fetches source/catalog JSON only. It contains no package fetching, materialization,
  runtime activation, audio, MIDI, or concrete-app behavior.

### Generic launcher

- Added the accessible `SheafPatchLauncher` view with a `SheafPatch` heading, live
  loading/availability status, application list, catalog diagnostics, and retry action.
- Each accepted row displays application name, publisher, author, category, and
  compatibility, and exposes one injected `select(app)` boundary.
- Selection immediately locks all rows. A rejected selection reports an alert on its
  row and permits retry. A resolved selection permanently forbids another in-page
  selection and exposes `Back to launcher`, whose default action is `location.reload()`.
- The success path does not overwrite a runtime DOM installed by a later selection
  callback: it re-renders the completed launcher state only while launcher markup still
  owns the root.
- All DOM uses validated catalog metadata and generic labels; there are no concrete
  application names, IDs, controls, or branches.

### Bootstrap and static shell

- Added exported `installSheafPatchLauncher` composition in `main.ts` while retaining
  all direct-runtime exports and the explicit legacy `data-synth-auto="true"` path.
- Changed production `index.html` to
  `data-synth-launcher="true" data-synth-catalog-sources="/catalog-sources.json"` and
  removed its direct `/dist/wasm/app.js` marker.
- Added generic responsive launcher styling.
- Updated static-site expectations so the one new non-module request is the trusted
  static source list rather than a backend request.

The implementation plan omitted `tests/runtime-core.spec.ts` from Task 2's file list
even though the required production bootstrap change made its old direct-auto-boot
assertion obsolete. The controller explicitly approved adding that file and replacing
only that assertion. The replacement proves startup requests source/catalog JSON,
does not request `/dist/wasm/app.js` or any package path, and leaves the callable direct
runtime composition test intact.

## TDD Evidence

### Initial RED: missing client contract

From `projects/synth/browser`, after adding tests and before production modules:

```sh
npm run build && node --test dist/tests/catalog-client.test.mjs && npx playwright test tests/launcher.spec.ts
```

Result: exit `1`. TypeScript compilation completed, then Node failed with
`ERR_MODULE_NOT_FOUND` for `dist/src/catalog-client.js`. This was the expected missing
Task 2 module failure. Because the required command uses `&&`, the Playwright phase did
not execute in that invocation.

### Initial RED: missing launcher UI

The first direct Playwright attempt was denied by the macOS Chromium sandbox
(`MachPortRendezvousServer ... Permission denied`), so it was rerun with the required
browser-launch approval:

```sh
npx playwright test tests/launcher.spec.ts
```

Result: exit `1`, 4/4 failed for expected missing behavior. The production page had no
`SheafPatch` heading or launch rows, and direct import of
`/dist/src/launcher.js` failed because the module did not exist.

### Client GREEN

```sh
npm run build && node --test dist/tests/catalog-client.test.mjs
```

Result: exit `0`, 4/4 passed. This covers concurrent request start, healthy-source
preservation across network/version failures, per-source diagnostics, stable-URL
revalidation, newly added manifest entries, and source-list trust rejection.

### Browser integration RED/GREEN refinement

The first browser run against the new implementation exposed a real integration defect:
the default window `fetch` function had been stored unbound, producing
`Illegal invocation` and 3 failures/1 pass. The existing launcher assertions were the
RED. Binding the default fetch through a closure was the minimal fix.

The next run reached the no-package assertion and showed it incorrectly counted the
launcher's own compiled `/dist/src/*.js` modules as application packages. The assertion
was narrowed to the actual package namespaces (`/packages/` and `/dist/wasm/`), retaining
the required discovery contract.

```sh
npm run build && npx playwright test tests/launcher.spec.ts
```

Result: exit `0`, 4/4 passed.

### Static regression RED/GREEN refinement

The first combined regression run passed the client and 12/13 browser tests. The old
static-site assertion expected no request beyond `/dist/` and `/public/`, and correctly
failed on the newly required `/catalog-sources.json` request. It was updated to assert
that exact static discovery request while retaining the no-WebSocket/no-backend gate.

### Final required GREEN

```sh
npm run build && node --test dist/tests/catalog-client.test.mjs && npx playwright test tests/launcher.spec.ts tests/static-site.spec.ts tests/runtime-core.spec.ts
```

Result: exit `0`; build passed, Node 4/4 passed, Playwright 13/13 passed.

Additional generic-boundary verification:

```sh
npm run check:generic-runtime
```

Result: exit `0`.

## Changed Files

- `.superpowers/sdd/task-2-report.md`
- `projects/synth/browser/src/catalog-client.ts`
- `projects/synth/browser/src/launcher.ts`
- `projects/synth/browser/src/main.ts`
- `projects/synth/browser/public/index.html`
- `projects/synth/browser/public/synth-browser.css`
- `projects/synth/browser/tests/catalog-client.test.mjs`
- `projects/synth/browser/tests/launcher.spec.ts`
- `projects/synth/browser/tests/static-site.spec.ts`
- `projects/synth/browser/tests/runtime-core.spec.ts` (controller-approved plan variance)

`projects/synth/browser/playwright.config.mjs` did not require modification because the
existing server and Playwright route fixtures expressed discovery on the current origin.

## Self-Review

- Re-read Task 2 brief, OpenSpec 2.1-2.4, `sbac-1`, `sbac-8`, and the relevant design
  decisions against the final implementation.
- Verified catalog validation/merge logic is reused exclusively from Task 1.
- Verified requests start concurrently and diagnostics retain configured-source order.
- Verified a failed or incompatible source cannot suppress healthy applications.
- Verified retry uses `no-cache` for both the source list and stable catalog URLs.
- Verified discovery never requests application entry/WASM/data/package paths.
- Verified launcher source has no miniapp/fake-app/package/audio/MIDI specialization.
- Verified selection has one injected boundary, rejects concurrent clicks, allows retry
  after failure, and permanently locks after success.
- Verified top-level reload is the default return mechanism.
- Verified the production index no longer names or auto-loads the direct WASM module.
- Verified direct runtime installation remains callable and covered.
- Verified `git diff --check` is clean.
- Verified the pre-existing untracked `projects/synth/browser/package-lock.json` and
  `projects/synth/miniapp/` artifacts remain unmodified and unstaged.
- Verified no OpenSpec checkbox was modified.

## Concerns

None blocking. The checked-in source-list artifact is deliberately Task 6, and package
materialization plus successful runtime selection are deliberately Tasks 3 and 4. Until
those tasks land, an un-routed production root reports a retryable source-list error and
the default selection boundary reports that application launch is unavailable; Task 2
tests inject discovery fixtures and selection behavior at those explicit boundaries.
