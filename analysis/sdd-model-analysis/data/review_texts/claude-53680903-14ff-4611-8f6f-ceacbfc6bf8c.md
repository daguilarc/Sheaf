## Review: `add-browser-wasm-synth-runtime`

I reviewed the working tree (which includes substantial uncommitted changes beyond the committed branch) read-only — no builds/tests run. Scope covered: boot/runtime/worklet/midi/storage JS, `BrowserMiniAppHost.cpp`, the `_headers`/Makefile deployment config, and the shared DSP/MIDI diffs.

**Bottom line: one blocking finding (reload persistence is not actually wired), plus deployment and MIDI-routing risks that should be resolved or explicitly deferred before a real Chrome release.**

---

### 🔴 BLOCKING — Reload persistence is non-functional in the wired app

The stated capability ("IDBFS storage reload persistence") does not hold for anything the running app writes. **Nothing ever calls `syncfs(false)` at runtime**, so in-memory IDBFS writes are never flushed to IndexedDB.

- `scheduleBrowserStorageSync` (the only caller of `syncBrowserStorageAfterWrite` → `syncfs(false)`) is only reachable via `handleBrowserStorageMessage` — `js/boot.js:206`, `:215`.
- `handleBrowserStorageMessage` is **defined but never registered/called** (no `addEventListener("message", …)` anywhere; grep confirms only the definition site). `appendBrowserLog` and `BrowserPatchStore` are likewise never invoked by the app.
- The C++ host has **no wasm→JS sync bridge** — no `EM_ASM`/`EM_JS`/`postMessage` in `BrowserMiniAppHost.cpp`. `sheaf_browser_storage_sync_started/finished` (`:434`, `:439`) only set a status enum; they don't touch the FS.
- Meanwhile the engine writes patches/config via `std::ofstream` in `src/PatchPersistence.cpp:225,341` (dispatched from UI actions through `sheaf_browser_dispatch_action`). Those bytes land in the in-memory IDBFS node and are lost on reload.

**The storage smoke test masks this**: `tests/smoke/storage-smoke.mjs:88-93` calls `FS.writeFile` + `FS.syncfs(false)` directly in `page.evaluate`, bypassing the app's (missing) wiring. It proves Emscripten IDBFS works, not that the app persists anything. Only the initial `syncfs(true)` populate (`boot.js:320`) runs in-app — read direction only.

Fix: wire a real flush path — either an unload/debounced `syncfs(false)` after engine writes, or a C++→JS post that reaches `scheduleBrowserStorageSync`, and change the smoke test to exercise the app path (save via UI action → reload → assert). If persistence is intentionally deferred for this milestone, say so in the spec and stop the smoke test from claiming it.

---

### 🟠 MEDIUM — COOP/COEP relies solely on a host-specific `_headers` file

Cross-origin isolation is delivered only by `public/_headers` (`:1-6`), which is the Netlify/Cloudflare Pages convention. Generic static hosts (GitHub Pages, S3/CloudFront default, `python -m http.server`) ignore it → `crossOriginIsolated` is false → `assertSharedMemorySupport` (`js/runtime.js:14`) short-circuits and the app never boots. Local dev/smoke masks this because `js/static-preview.mjs:16-19` injects the headers server-side. Make the hosting requirement explicit (and ideally add a matching config for the actual deploy target) so the app doesn't silently die on a non-conforming host.

### 🟠 MEDIUM — Selected MIDI-output routing is not honored

`BrowserMidiAdapter.drainOutput` resolves every message to `selectedOutputPortId ?? defaultOutputPortId()` (`js/midi.js:234,253`), but `setSelectedOutputPortId` is never called and the C++ sink (`BrowserMidiOutputSink::Send`, `BrowserMiniAppHost.cpp:38`) strips all port identity — it pushes raw bytes only. So all engine MIDI output (including sysex) is blasted to the *first* output port regardless of the user's per-controller endpoint configuration, even when the user selected "none." `commitBrowserMidiEndpointEdit`/`buildBrowserMidiControllerState` exist but aren't wired into `ui-renderer`/`boot`. Either propagate the engine's output-ref to the JS adapter or document single-output-only as a limitation.

### 🟠 MEDIUM — Fixed 2560 MB non-growth heap is desktop-only and fail-hard

`Makefile:10-12` pins `INITIAL_MEMORY=2560MB` with `ALLOW_MEMORY_GROWTH=0`. This is a single up-front `SharedArrayBuffer` commit that many mobile/low-RAM Chrome instances cannot satisfy → module instantiation throws and boot fails. It's also blunt: if real usage ever approaches the cap there is no growth, just a hard OOM. Fine as a desktop-Chrome-only assumption, but that assumption should be explicit, and the number looks un-tuned relative to actual footprint (wavetables are `static` singletons, so the driver of 2.5 GB isn't obvious from the code).

---

### 🟡 LOW / residual

- **Dead "module transfer into worklet" path.** The shipped audio path is Emscripten `AUDIO_WORKLET`/`WASM_WORKERS` (`sheaf_browser_start_audio` → `emscripten_create_wasm_audio_worklet_node` → `ProcessBrowserAudio`, sharing one `SharedArrayBuffer`). The hand-rolled `js/worklet-processor.js` (`registerProcessor("sheaf-synth")`) and `buildWorkletInitMessage` (`runtime.js:29`) are never loaded (`addModule` is never called). So the "compiled `WebAssembly.Module` transfer into the worklet" you asked about is **not** the real mechanism — it's unused scaffold. Recommend deleting it to avoid false confidence and drift.
- **Mutex on the audio render thread.** The Emscripten `MidiSender::Enqueue` path (`src/MidiController.cpp`, `#ifdef __EMSCRIPTEN__`) takes `std::lock_guard(mutex_)` during `ProcessBlock`. Critical section is tiny (read a pointer) and the actual send is a lock-free SPSC push, but it's still a lock on the realtime thread contended by main-thread Start/Stop/ClearSink — a priority-inversion hazard at start/shutdown.
- **Wavetable singleton built lazily on the first audio block.** `MakeDefaultMorphingWavetable` (`DspWavetable.hpp:318`) backs a function-local `static` reached first during audio processing → one-time DFT construction + magic-static lock on the worklet thread = a startup underrun. Consider warming it on the main thread inside `sheaf_browser_prepare`.
- **Full UI frame re-serialized every message tick.** `RefreshUiFrame` rebuilds tree + JSON at 60 Hz unconditionally (`BrowserMiniAppHost.cpp:363-372,128-140`); `BrowserRuntime.readFrame` only dedupes rendering, not the C++ rebuild. Main-thread waste, not correctness.
- **MIDI-out drop risk** at high rates: SPSC output queue is capacity-bounded and drained only ~60 Hz (`boot.js:57`, `drainOutput` max 128/frame) — bulk sysex/MPE bursts can drop.

---

### Native regression risk (shared DSP/MIDI): LOW

- All `MidiController.cpp` changes and the `kMaxLevels` change are `#ifdef __EMSCRIPTEN__`-guarded; the native path is byte-identical (`#else` branches preserve the originals). Verified the native `Enqueue`/`Stop`/`ClearSinkSync` bodies are unchanged.
- The two **unguarded** `DspWavetable.hpp` changes are behavior-preserving: `Add(AdaptiveWavetable&&)` (`:287`) — all callers pass temporaries (`tests/dsp_tests.cpp:527-528`, `MakeDefaultMorphingWavetable`), so no lvalue-caller breaks; and the `MakeDefaultMorphingWavetable` heap-alloc rewrite (`:318-333`) produces identical tables (`m_waveTable = move; Generate()` matches `MakeAdaptiveWavetable`). `m_tables`/`m_waveTable` are public struct members, so it compiles.
- One divergence to note, not a regression: browser `kMaxLevels=8` vs native `25` means the browser build anti-aliases more coarsely — audibly different timbre at high notes than native. Acceptable but worth documenting as intended.

I did not run the build or test suites (read-only review). The persistence finding in particular can't be caught by the current suite because the smoke test exercises `syncfs` directly rather than through the app.