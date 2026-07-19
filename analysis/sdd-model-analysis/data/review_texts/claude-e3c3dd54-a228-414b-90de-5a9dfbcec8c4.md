I have enough to complete the review. Let me do one final parity check on the native identifier validation versus the JS `ID_PATTERN` for a tricky case, then write up findings.

The JS `ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` and C++ `IsBrowserPersistenceIdentifier` both: reject empty, reject leading/trailing hyphen, reject consecutive hyphens, allow only lowercase+digits+single-hyphen — parity confirmed. Version constants match (both `1`). Now the review.

---

### Spec Compliance

✅ **Spec compliant**

Every binding constraint is satisfied by the code, not merely by returned strings:

- **Only validated `{publisherId, appId, runtimeConfigVersion}` crosses the boundary.** `main.ts` removed `dataRoot`; the catalog path derives identity via `runtimeIdentityForCatalogApp` (`catalog.ts:125`), which re-runs full `identifier()`/`exactVersion()` validation. The remaining `dataRoot` references (`persistence.ts:11,35,80,81`) are the fixed `/data` mount point, never caller-supplied.
- **One shared IDBFS at `/data`; shared config/logs; patches isolated at `/data/patches/<publisher>/<app>`.** `deriveBrowserPersistencePaths` (`persistence.ts:32`) and native `BrowserPersistentDataPaths` (`BrowserPersistence.hpp:44`) both produce exactly this; `FromRoots` arg order (dataRoot, patches, logs, config) matches `AppContext.hpp:54`.
- **Build ID never enters any path.** The identity record has no `buildId` field; `runtimeIdentityForCatalogApp` reads only `publisher.id`, `appId`, `browser.runtimeConfigVersion`. Native/JS tests both assert the same-publisher/same-app root is stable across two build IDs and that two publishers of the same app ID get distinct roots.
- **Version negotiation rejects before any FS mutation.** `worker.ts:364` validates identity *before* constructing/starting persistence; the incompatible-version test proves `calls === ["create"]` and the persistence factory throws if reached. Native `BrowserPersistentDataPaths` throws on `runtimeConfigVersion != 1` *before* `SetRuntimeDataPaths`/`Start` (`BrowserRuntime.hpp:493`), so `Initialize` returns -1 with zero writes.
- **Populate-before-init and app-isolated debounce preserved.** `persistence.start()` awaits `sync(true)` before `module.initialize` (`worker.ts:374-377`); order asserted by the persistence spec (`mkdir…/sync:true/initialize/sync:false`). Identity is captured once per app-scoped `BrowserPersistence` instance and drives `paths.patchesRoot`; debounced `scheduleSync`/`flush` read only that instance's `paths`, so no cross-app flush leakage.
- **Centralized, unbypassable derivation.** All three entry points (direct `installSynthBrowserApp`, worker `initialize`, `BrowserPersistence` ctor) funnel through `validateBrowserRuntimeIdentity`; direct/worker modes cannot supply a raw path. JS↔C++ validation parity confirmed (same charset, hyphen, and version rules).

⚠️ **Cannot verify from diff:** I did not execute the suites (read-only review). The report's 31/31 Node, 96/96 Playwright, and native-contract-pass claims are taken as given from the report; code inspection is consistent with them.

### Strengths

- Defense-in-depth validation at four layers (catalog extraction, worker command, persistence ctor, native ABI) with matching JS/C++ semantics, so no single bypass reopens the namespace boundary.
- The zero-write ordering is genuinely enforced, not just asserted: version validation strictly precedes persistence construction on both the JS and native sides, and the test verifies the persistence factory is never invoked for version 2.
- Tests exercise the real wiring (worker → persistence → mkdir/mount/sync call log; native `RuntimeDataPaths` used by `RuntimeAbiAdapter::Initialize`), not just returned path strings — the legacy `FromDataRoot` global-path branch was deleted, closing the "test inspects strings while runtime uses legacy path" trap.
- ABI string lifetimes are correct: nested `withUtf8` keeps `publisherId`/`appId` alive across the synchronous `_synth_browser_initialize`, and C++ copies into `std::string` inside `FromRoots`.

### Issues

**Critical:** None.

**Important:** None.

**Minor:**

- **Playwright discovery noise — classified as pre-existing, not a Task 5 isolation defect.** `playwright.config.mjs` sets `testDir: "./tests"` with no `testMatch`, so Playwright's default glob also captures the Node `*.test.mjs` files (`catalog.test.mjs`, `package-contract.test.mjs`, etc.). That is what prints the parallel `package-app` marker. Task 5 touches none of these files, the config, or `package-app.mjs`, and the canonical serial gate (`node --test dist/tests/*.test.mjs`) passes 31/31 including `package-contract` — so the marker is a test-runner concurrency artifact (two runners importing the same Node test), **not** a persistence-namespace isolation problem introduced or exposed by Task 5. Confidence: high. Suggested (out-of-scope for this task) fix: add `testMatch: "**/*.spec.ts"` to the Playwright config so it stops importing Node test files.
- **No direct native test of `Initialize()` returning -1 for version 2.** `TestBrowserPersistenceIdentityDerivesSharedAndIsolatedRoots` proves `BrowserPersistentDataPaths(...,2)` throws, and code inspection shows `RuntimeAbiAdapter::Initialize` catches and returns -1 before `Start()`. The gating mechanism is covered; a test asserting `Initialize(pub, app, 2) == -1` with no `Start` side-effect would make the native zero-write guarantee explicit rather than inferred. Not blocking.
- **Shared `/data/config.json` and `/data/logs` across all publishers** are intentional per the binding constraint ("shared config/log data is compatible across apps"), so this is spec-compliant — flagging only so a future reviewer doesn't mistake it for a leak. No action.

### Assessment

**Task quality: Approved**

The persistence identity contract is implemented correctly and matches the spec on identity validation, namespace isolation (`/data/patches/<publisher>/<app>`), build-ID exclusion, shared config/logs, version-negotiation-before-mutation, and mount/populate ordering, with parity across the JS and C++ validation paths and tests that drive the real runtime wiring. The only findings are Minor: the Playwright marker is pre-existing discovery noise unrelated to Task 5, plus two optional test/config hardening suggestions.

I'll stay open for post-fix re-review.