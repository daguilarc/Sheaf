# Task 8 report: publisher and coverage documentation

## Checklist

- [x] Source-list trust, relative resolution, HTTPS/loopback policy, independent diagnostics/retry, and registered-publisher trust are documented.
- [x] Schema v1 documents every exact field, strict unknown-field policy, metadata, versions, immutable build ID, entry, and file records.
- [x] Global identity, deterministic merge/duplicate behavior, multi-app catalogs, stable patch roots, and publisher isolation are documented.
- [x] Immutable layout, decoded-byte hashing, MIME/CORS, object URLs, Emscripten sidecars, and disposal are documented.
- [x] Embedded-library compatibility/version policy, cache/update behavior, one-active-app navigation, and host-owned audio/MIDI are documented.
- [x] Cloudflare/Pages boundaries, live-evidence limits, local commands, second-repository multi-app example, manual registration, security limits, and rollback boundary are documented.
- [x] `sbac-1` through `sbac-12` and modified `sprs-12` each have one coverage-map entry with real named gates.

## Verification record

Completed after documentation changes:

- `npm --prefix projects/synth/browser test` passed outside the sandbox: 53 Node tests and 101 Playwright tests passed, with one configured remote-origin test skipped.
- The first sandboxed Playwright attempt was blocked before test execution by Chromium Mach-port permission denial (`bootstrap_check_in ... Permission denied (1100)`); the elevated rerun passed without source changes.
- `npm --prefix projects/synth/browser run publish:site`
- `npm --prefix projects/synth/browser run publish:pages`
- `openspec validate add-browser-app-catalog-launcher --strict`
- Markdown link/path checks, requirement-ID/obsolete-wording `rg` checks, and `git diff --check`.

The deployed catalog validator is intentionally documented but not invoked with a
real URL here: that would require a deployment and expected build ID. The green
two-origin/deployed-origin coverage in the browser suite is its non-deploying
validation form.
