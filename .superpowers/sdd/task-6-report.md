# Task 6 Report: Native Browser Audio and Generic App Packaging Integration

## Status

DONE — the integration regression found by the prescribed full browser command
was repaired with strict TDD, the reviewer-requested fixture polish was repaired
with strict TDD, every prescribed local gate is green, and both required Claude
Opus reviews finish with no unresolved actionable findings and merge approval.

Per controller instruction, this task did **not** modify
`openspec/changes/fix-browser-native-audio-and-generic-app-packaging/tasks.md`
or any other OpenSpec checkbox.

## Commits

- `44b38a7e` — `test(synth-browser): harden generic native app hosting`
- The final review-fix and this evidence report are committed together by the
  Task 6 completion commit.

## Verified Integration Defect and Strict TDD Repair

The first full unsandboxed browser run reached Chromium and reported Node
73/73, then Playwright 94 passed / 5 failed / 2 skipped. The five failures were
all stale integration fixtures after the ABI-v2/native-audio migration:

- The full test script did not rebuild the isolated real-Wasm fixture.
- `fake-app.e2e.spec.ts` still read the old top-level underscore-named ABI-v1
  emission and used the worker realm, which cannot clone an `AudioContext`.
- The first MIDI fake still advertised ABI 1.
- The package-loader mapping fake advertised ABI 1 and lacked the two native
  audio registration/start symbols now required by the generic runtime.

RED was recorded before implementation:

- A new scaffold contract failed 7/8 because the `test` script lacked
  `make browser-fixture-app` before Playwright.
- Focused MIDI/package-loader Playwright failed 0/2 on ABI-v2 contract errors.
- Focused fake-app Playwright failed 0/3 while loading the obsolete emission.

The minimal repair:

- Builds the isolated fixture before Playwright in the full suite.
- Reads `dist/wasm/fixture-apps/fake-browser-app/fake-browser-app.{js,wasm}`.
- Uses ABI 2 in all affected fakes and supplies the two required native-audio
  symbols in the mapping fixture.
- Drives the real Wasm fixture with an in-realm direct runtime client, one real
  leased `AudioContext`, and a proxied real `AudioWorkletNode`; it requires the
  native node to connect and then proves bounded, exactly-once resource teardown.

Focused GREEN after the repair was scaffold 8/8, MIDI/package loader 2/2, and
real fake-app 3/3. The only assertion adjustment was to require native context
resumes `>= 1` because the real browser lifecycle can resume more than once;
all ownership, materialization, connect/disconnect, disposal, and close counters
remain exact.

## Whole-Review Finding and Strict TDD Repair

The fresh whole-branch reviewer found one non-production Minor: the two-origin
dev-server fixture catalog advertised ABI 1 while its served module and runtime
negotiation used ABI 2.

RED:

```sh
cd projects/synth/browser
npm run build && npx playwright test tests/two-origin-package.spec.ts
```

Result: exit 1, one failed; the new regression assertion reported `Expected: 2`
and `Received: 1`.

Minimal fix: change the served fixture catalog to ABI 2 and retain the test's
assertion against the actual fetched catalog value.

GREEN: the same command exited 0, one passed. `git diff --check` remained clean.
The same fresh reviewer re-reviewed the two-file fix and reduced the unresolved
actionable count to zero.

## Final Fresh Verification

The following commands were rerun from the final code state after the last fix.

### Native and browser contracts

```sh
make -C projects/synth build/browser_runtime_contract_tests
projects/synth/build/browser_runtime_contract_tests
npm --prefix projects/synth/browser run build
npm --prefix projects/synth/browser run check:generic-runtime
node --test projects/synth/browser/dist/tests/*.test.mjs
```

All exited 0. The native contract binary passed silently. TypeScript and the
generic-boundary scan passed. Node reported 74 tests, 74 passed, 0 failed,
0 skipped.

### Real app builds and complete browser suite

```sh
make -C projects/synth/browser browser-apps
npm --prefix projects/synth/browser test
```

Both exited 0. The common builder compiled Mini App and unchanged Braid 4. The
complete browser command rebuilt the isolated real-Wasm fixture, then reported:

- Node: 74 passed / 0 failed / 0 skipped.
- Playwright: 99 passed / 0 failed / 2 skipped, 101 discovered.
- The two skips are exactly `deployed-origin.spec.ts` for Mini App and Braid 4
  because no remote deployment URL was supplied.

An earlier sandboxed browser attempt could not launch Chromium because macOS
Mach bootstrap registration was denied (`Permission denied (1100)`). It was
rerun outside the sandbox as required; this was an environment restriction, not
a product failure.

### Complete native synth suite

```sh
make -C projects/synth test
```

Exit 0 across the UI boundary check and all 24 native test binaries:

`parameter_modulation`, `button_grid`, `dsp`, `module`, `instrument`,
`contract`, `logging`, `engine`, `rig`, `miniapp_system`, `braid4_system`,
`braid4_deadline`, `reconcile`, `reconcile_executor`, `poller`, `midi_sender`,
`viewmodel`, `blocks`, `portable_ui`, `runtime_main_component`,
`runtime_file_service`, `controllers_page_ui`, `browser_command_buffer`, and
`browser_audio_device` tests.

All five Braid 4 deadline cases passed:

- Baseline 44.1 kHz: avg 1.30755 ms, p99 1.451 ms, block 5.80499 ms.
- Baseline 48 kHz: avg 1.2892 ms, p99 1.41025 ms, block 5.33333 ms.
- Baseline 96 kHz: avg 1.26145 ms, p99 1.39338 ms, block 2.66667 ms.
- Sparse 48 kHz: avg 1.30806 ms, p99 1.43767 ms.
- Sparse 96 kHz: avg 1.26745 ms, p99 1.40383 ms.

### Publication rebuild and exact artifact inspection

```sh
npm --prefix projects/synth/browser run publish:site
npm --prefix projects/synth/browser run publish:pages
```

Both exited 0. An independent Node inspection and a recursive catalog-tree diff
also exited 0 and established:

- Catalog version:
  `first-party-c9081639f5c39389244c2817308d4b7890269dc149793c6afec5da0f6089895d`.
- Ordered applications: Braid 4, then Mini App; both ABI 2.
- Braid build ID:
  `37359a3bb474489cb937684db373d6f1803a366571fb5046eacace8e883e2cff`.
  - JS: 101681 bytes, `text/javascript`, SHA-256
    `9026c83dbd0460f5b96b513d838cb22225b6debec110e8ff411e70d7979dddcd`.
  - Wasm: 1014964 bytes, `application/wasm`, SHA-256
    `3c549337cf0c38f85981f2157d9b8ddbc33dea5969a8aa878645249e1443a834`.
- Mini App build ID:
  `f296c12dbce68665df911e5f995340f9d886aa77a1c0bb55ffaee7e40b3112ff`.
  - JS: 101681 bytes, `text/javascript`, SHA-256
    `53db2542792b154687274840ba12aa181d4b1910aa6fad2d711ffa24fe0cbe8a`.
  - Wasm: 985155 bytes, `application/wasm`, SHA-256
    `5612c75732084e23160f12e3de48f83b9705dde1e7c9b683c503f388eb2e65e7`.
- The site and Pages catalog/package trees are byte-identical.
- Cloudflare site: 23 files, 12 runtime modules, launcher/source list/CSS,
  `_headers`, and exactly two generic rollback pages.
- Pages publisher: 5 files and top-level `catalogs` only.
- `catalog-sources.json` contains only `catalogs/sheaf/catalog.json`.
- `_headers` contains global COOP/COEP/MIDI plus explicit JavaScript and Wasm
  MIME rules.

The real Chromium suite separately proves root discovery loads no package bytes,
both rows select through the same native callback path, native block counts
advance with non-silent output and finite deadlines, and teardown is exact.

### Specification, genericity, and hygiene

```sh
openspec validate fix-browser-native-audio-and-generic-app-packaging --strict
git diff --check
git status --short
```

Strict validation exited 0 (`Change ... is valid`); whitespace validation was
clean. The generic-runtime scan found no app-specific branch. No per-app entry
`.cpp` remains. Braid sources have no diff from feature base
`a14cabf9b2ecfd27f0b0a918a993af2cf6c34979`.

Final protected-artifact comparison matched the initial baseline exactly:

- `projects/synth/browser/package-lock.json`: SHA-256
  `cf5a5e984436127a71533c99ccfca3847028d44efe6421c8c2a8ee8a64a24c0f`,
  2733 bytes, mtime `1784422621`.
- `projects/synth/miniapp/`: the same 14 files and the same 14 SHA-256 values.

Neither protected path was staged or modified. After committing Task 6, they
are the only expected working-tree entries.

## Reviewer Evidence

### Persistent Task 6 review

- Run ID: `xrun_20260719195910097_d16f789a` (Claude Code, Opus, persistent).
- Findings: Critical 0, Important 0; four non-actionable Minors only (structural
  ordering guard backed by behavioral coverage, justified native resume-count
  relaxation, harmless redundant property assignment, and explicitly optional
  negative-branch coverage).
- Verdict: `SPEC COMPLIANCE: PASS`, `CODE QUALITY: PASS`, no unresolved
  actionable findings, `APPROVE (merge-ready)`.
- No fix/re-review loop was required for this review.

### Fresh whole-branch release review

- Run ID: `xrun_20260719200617434_1684d081` (Claude Code, Opus, fresh context).
- Exact initial range: merge base
  `6a16506573d57b03ee0dbaa2880785684415e9a0..44b38a7e`.
- Initial findings: Critical 0, Important 0, one actionable non-blocking Minor
  for the stale two-origin fixture ABI; merge readiness already approved.
- Fix loop: strict RED/GREEN above, followed by same-context re-review.
- Final verdict: `SPEC COMPLIANCE: PASS`, `CODE QUALITY: PASS`,
  `UNRESOLVED ACTIONABLE FINDINGS: 0`, `MERGE READINESS: APPROVE`.

An earlier xagent process (`xrun_20260719194447211_d9b74ea5`) received no
provider turn because an oversized PTY prompt was rejected. It was closed and is
not counted as a reviewer run; both reviewer IDs above are healthy completed
provider turns.

## Minor-Note Triage

- Task 1 optional zero-registration/start-after-shutdown branch coverage remains
  optional; the implementation already enforces the boundary.
- Task 2 fixture isolation/stale-output note is resolved by the shared builder's
  dedicated `fixture-apps` output root; category spelling remains intentional.
- Task 3 flat header assumption and standalone atomic catalog replacement match
  the accepted artifact contract.
- Task 4 no-lockfile/rollback companion-file notes are intentional constraints.
- Persistent reviewer Minors are cosmetic or explicitly optional, not defects.
- Fresh reviewer Minor was verified, fixed with TDD, and re-reviewed clean.

## Remaining Skips, Warnings, and Concerns

- Skips: exactly two live deployed-origin smoke cases, one for each app, because
  no remote URL was configured. Live deployment remains CI-owned.
- Warnings: Emscripten reports `-pthread + ALLOW_MEMORY_GROWTH` may be slower and
  that `USE_PTHREADS` is deprecated; Node/Playwright reports `NO_COLOR` ignored
  because `FORCE_COLOR` is set. These are unchanged toolchain warnings.
- Concern: actual Pages CORS/Wasm MIME and Cloudflare response headers cannot be
  proven without deployment; workflow contracts and loopback/artifact checks are
  green. No push, deploy, Pages enablement, archive, or external mutation was
  performed.
- No remaining local correctness or merge-readiness concern.
