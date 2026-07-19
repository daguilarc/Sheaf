# Task 7 Report: GitHub Pages Publisher Path

## Status and scope

Implemented Task 7 from base commit `053ed292` in the implementation commit
named `ci(synth-browser): publish catalogs through GitHub Pages`.

The change adds a GitHub Pages publisher workflow, a deployed-catalog
validator, parsed workflow and HTTP fixture tests, and an opt-in remote-origin
Chromium readiness smoke. The Pages artifact is deterministically extracted
from the already validated Task 6 publication as `catalogs/` plus referenced
immutable packages only. The existing Cloudflare artifact remains the
cross-origin-isolated launcher.

The real catalog package contract now includes a nonnegative safe-integer
decoded byte `size`. Assembly emits it, catalog parsing requires it, the local
package loader verifies it, the Task 6/Pages publisher verifies it, and the
deployed validator verifies it together with media type and SHA-256.

No repository settings or external deployment were changed. OpenSpec
checkboxes and `.superpowers/sdd/progress.md` were not edited. The pre-existing
untracked `projects/synth/browser/package-lock.json` and
`projects/synth/miniapp/` were preserved and excluded from the commit.

## Pinned action verification

On 2026-07-19, each action tag was resolved directly from its primary GitHub
repository with this command shape:

```text
git ls-remote --tags https://github.com/<owner>/<repository>.git "refs/tags/<tag>^{}" "refs/tags/<tag>"
```

All commands exited 0 and returned:

```text
actions/checkout v7.0.0
9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0

actions/setup-node v7.0.0
820762786026740c76f36085b0efc47a31fe5020

actions/configure-pages v6.0.0
45bfe0192ca1faeb007ade9deae92b16b8254a0d

actions/upload-pages-artifact v5.0.0
fc324d3547104276b827a68afc52ff2a11cc49c9

actions/deploy-pages v5.0.0
cd2ce8fcbc39b97be8ca5fce6e763baed58fa128

emscripten-core/setup-emsdk v16
4528d102f7230f0e7b276855c01ea1159be0e984
```

The workflow also pins Node `22.17.1` and Emscripten `6.0.3` exactly.

## RED evidence

### Workflow structure

```text
npm run build && node --test dist/tests/github-pages-workflow.test.mjs
```

First genuine RED: exit 1 because
`.github/workflows/synth-browser-pages.yml` did not exist. After adding the
minimum workflow skeleton, the expanded parsed-YAML contract produced 1 pass
and 5 failures for the missing responsibilities, permissions, pinned actions,
commands, artifact path, and readiness ordering.

GREEN after implementation: 6/6 workflow structure tests passed. The tests use
`yaml.parse` and assert the resulting job/step structure; they do not grep the
workflow as a free-form string.

### Deployed validator

```text
npm run build && node --test dist/tests/github-pages-workflow.test.mjs
```

RED: the 6 workflow tests passed and all 7 deployed HTTP fixture tests failed
because `src/validate-deployed-catalog.mjs` did not exist.

GREEN: all validator fixtures passed, covering success and rejection of
missing package CORS, bad live WASM MIME, unexpected build ID, a package path
outside its immutable root, declared-size mismatch, and SHA-256 mismatch.

### Declared package size

```text
npm run build && node --test dist/tests/catalog.test.mjs
```

RED: exit 1; the parser rejected the new fixture field as unknown, producing
11 failures and demonstrating that declared size was not part of the real
catalog contract.

```text
npx playwright test tests/package-loader.spec.ts --grep "declared package size"
```

RED outside the sandbox: exit 1; the loader returned `accepted` instead of
rejecting decoded bytes whose length differed from the declaration.

GREEN: the focused loader test passed 1/1 and the combined catalog/validator
Node run passed 30/30.

### Pages-only artifact extraction

```text
npm run build && node --test dist/tests/package-contract.test.mjs dist/tests/publish-site.test.mjs
```

RED: exit 1 with an import error because `publishPublisherArtifact` did not
exist.

GREEN: 11/11 package and publication tests passed. The new test proves a
byte-stable Pages root whose only top-level entry is `catalogs`, with every
catalog reference remaining within the immutable app/build root.

### Deployed-origin readiness smoke

```text
SYNTH_BROWSER_REMOTE_CATALOG_URL=http://127.0.0.1:4174/dist/pages/catalogs/sheaf/catalog.json \
SYNTH_BROWSER_EXPECTED_BUILD_ID=db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a \
npx playwright test tests/deployed-origin.spec.ts
```

RED: exit 1 with `Error: No tests found` before the spec existed.

GREEN outside the sandbox: 1/1 passed. The smoke observed the expected remote
build, cross-origin catalog/entry/WASM fetches, blob worker creation, host
AudioWorklet module/node/connect, one resumed `AudioContext`, and launcher
readiness. Without `SYNTH_BROWSER_REMOTE_CATALOG_URL`, the spec intentionally
skips.

### Documentation

```text
npm run build && node --test --test-name-pattern "publisher documentation" dist/tests/github-pages-workflow.test.mjs
```

RED: the focused assertion failed because the README had no one-time GitHub
Pages source/settings instructions.

GREEN: 1/1 focused documentation test passed after the README documented the
GitHub Actions Pages source, stable catalog URL, publisher-only boundary,
CORS/MIME/size/hash expectations, explicit smoke variables, Cloudflare launcher
role, and local-versus-live evidence boundary.

## Final verification evidence

```text
npm run build && npm run check:generic-runtime && node --test dist/tests/*.test.mjs
```

Result: exit 0; TypeScript and the generic-runtime guard passed, then 52/52 Node
tests passed. This isolated rerun also confirmed a one-off package CLI marker
seen while the complete parallel Playwright server was assembling the same
temporary fixtures was fixture contention, not a repeatable failure.

```text
SYNTH_BROWSER_REMOTE_CATALOG_URL=http://127.0.0.1:4174/dist/pages/catalogs/sheaf/catalog.json \
SYNTH_BROWSER_EXPECTED_BUILD_ID=db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a \
npx playwright test tests/package-loader.spec.ts tests/two-origin-package.spec.ts tests/static-site.spec.ts tests/deployed-origin.spec.ts
```

Result outside the sandbox: exit 0; 19/19 passed. This covers the size contract,
the existing two-origin package behavior, Task 6 publication/rollback behavior,
and the production-like deployed-origin smoke.

```text
npx playwright test
```

Result outside the sandbox: exit 0; 101 passed and 1 deployed-only test skipped
because its opt-in remote URL was intentionally unset.

```text
npm run publish:site && npm run publish:pages
```

Result: exit 0. The deterministic first-party Pages catalog build ID was
`db7b6e56b8fbffe20ef24d6b7347d712f0194eb62b152a0c6e2657256373e40a`.

```text
openspec validate add-browser-app-catalog-launcher --strict
git diff --check
```

Result: both exited 0; OpenSpec reported the change valid and the diff check
reported no whitespace errors. Generated screenshot churn was restored before
staging.

## Evidence boundary and remaining concern

Local tests prove the deterministic Pages artifact, parsed workflow contract,
validator behavior, and production-like cross-origin readiness path. They do
not prove the response headers or media types served by a live GitHub Pages URL,
and they do not prove live Cloudflare headers. Those facts become evidence only
when the default-branch workflow deploys and its explicit validation and smoke
jobs pass. This task deliberately did not deploy, enable Pages, change the
repository Pages source, or claim either live result.
