I have completed a full read-only review of the change: the six source-of-truth OpenSpec artifacts, the plan, the complete seven-commit diff package, and the Task 1/4 evidence reports. I verified the reported claims against the actual code (PCG32 constants, open-interval mapping arithmetic, lifetime deletes, MiniApp wiring, and test assertions) rather than inheriting prior conclusions.

---

# Final Whole-Change Review: Noise Modulator

### Strengths

- **Exact open-interval contract is provably correct.** `FastPcg32::UniformOpen01` (`DspNoise.hpp:36-38`) takes the top 23 bits and returns `(bits + 0.5) * 2^-23`. Min = `2^-24`, max = `8388607.5/8388608 = 1 − 2^-24`; the `+0.5` addition is exactly representable in `float` for all `bits ≤ 2^23−1`, and the multiply is a pure exponent shift, so no rounding pushes a value to `0.0` or `1.0`. This matches `design.md:35` and is exercised across 16,384 samples in `dsp_tests.cpp` (`noise_modulator_explicit_seed_is_repeatable_and_strictly_open`).
- **PCG32 output and seeding are standard and accept every seed.** `NextWord` (`DspNoise.hpp:16-22`) is the canonical PCG-XSH-RR step; the fixed increment `1442695040888963407ULL` is odd (full period), and `Seed` (`DspNoise.hpp:33-38`) zero-then-add mirrors `pcg32_srandom_r`, neutralizing the degenerate-zero-state risk in `design.md:64`.
- **Hot path is genuinely allocation/lock/entropy/exception-free.** `Process()` (`DspNoise.hpp:52-56`) is one PRNG step + one store per voice, `noexcept`, with all allocation confined to the constructor. `static_assert(noexcept(...Process()))` at `dsp_tests.cpp:530` locks this in.
- **Pointer-lifetime contract is enforced structurally, not just tested.** Non-copyable/non-movable deletes (`DspNoise.hpp:57-60`) plus constructor-only `outputs_`/`sourcePointers_` allocation guarantee address stability; four `static_assert`s (`dsp_tests.cpp:525-528`) and `noise_modulator_keeps_registered_output_addresses_stable` prove it.
- **Registration proven through the real API, not a mock.** `noise_modulator_registers_directly_as_pointer_backed_group_source` builds an actual `ParameterGroup`, calls `SetModulationSource` with the span, and asserts `Value(voice,0) == Output(voice)` — proving the "no adapter storage" clause of `sdsp-34`.
- **MiniApp integration is minimal and ordered correctly.** `numModulators` 3→5, `SetModulationSource(4, …)` with `Noise`/White/connected metadata, `noiseModulator_.Process()` immediately before `UpdateModValues` (`MiniAppCore.hpp:206-207`), visualizer attached only at index 4 (`MiniAppCore.hpp:317`). Index 3 is never registered. No parameters, banks, pages, scope channels, or audio routing added.
- **Visualizer is model-free and independent.** `NoiseWaveformVisualizer` holds only a `Color` and a private `mutable FastPcg32` — no processor pointer, scope, or UIState — regenerates a fresh per-column polyline each `DrawVisible()`, clamps y into `(bounds.y, bounds.y+height)`, and handles empty/negative/NaN/inf bounds safely (`NoiseWaveformVisualizer.hpp:26-31`). Base contracts (visibility, exact bounds, builder node ordering, non-copy/move) are all asserted in `portable_ui_tests.cpp`.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. **`DspNoise.hpp:41-43` / `DspNoise.hpp:80-81` — default zero-voice construction draws entropy before rejecting.** The delegating default constructor evaluates `NoiseInitializationSeed()` (a `std::random_device` read) before the `voiceCount == 0` check throws. Wasteful, non-fatal, off the audio path, and the `sdsp-34` "fails before any source can be registered" clause still holds (verified by `noise_modulator_requires_positive_runtime_voice_count`, which uses the seeded ctor). Optional fix: validate `voiceCount` in the default ctor before delegating. Severity confirmed Minor.

2. **`NoiseWaveformVisualizer.hpp:33-35` — pathologically large finite width could throw on `reserve`.** `wholeColumns = static_cast<std::size_t>(std::floor(bounds.width))` then `points.reserve(wholeColumns + 2)`; a finite but enormous width would overflow allocation. Bounds derive from encoder-cell geometry (small, not externally controlled) and the throw would surface on the UI thread, not audio. Low-probability. If desired, clamp `wholeColumns` to a sane maximum. Severity confirmed Minor.

3. **`miniapp_system_tests.cpp:730` — two-block non-repeat assertion is probabilistic.** `first0 != second0 || first1 != second1` could theoretically pass falsely, but the collision probability across two independent open-interval floats is ~`2^-46` — negligible and effectively deterministic. Could be made strictly deterministic with an explicit-seed hook, but not warranted. Severity confirmed Minor.

4. **`coverage.md:307` (`spv-6` row) — wording does not name the five-slot topology.** The mapping is accurate and traces to real tests; naming the index-4/five-slot relationship explicitly would aid future auditors. Pure doc polish. Severity confirmed Minor.

I independently judged each prior-flagged item at whole-change scope and concur they are all Minor; none rise to Important.

### Requirements Assessment

Complete. All modified and added requirements are implemented with nothing material missing or extra:
- `sdsp-34` (runtime voice count, stable storage, strict `(0,1)`, deterministic seed, one word/voice, allocation/lock/entropy/crypto-free) — fully implemented and tested.
- `sdsp-35` (five slots, noise at index 4, one process before mod-update, retained visualizer, index 3 unclaimed) — implemented in `MiniAppCore.hpp`, covered by three MiniApp tests.
- `spv-6` / `sdsp-33`(mod) / `sdsp-13`(mod) — model-free per-pixel redraw visualizer, three-scope-visualizer count preserved and separated from noise, five-modulator group. No parameters, banks, pages, persistence, scope channels, backend code, or audio routing added, consistent with the Non-Goals.

### Verification Assessment

Trustworthy. Code reading confirms the reports' claims: static asserts and behavior tests exist as described, the integration test uses a real `ParameterGroup`, and the Makefile correctly adds `DspNoise.hpp`/`NoiseWaveformVisualizer.hpp` to `DSP_HEADERS`, the MiniApp system-test, and portable-UI-test dependency lists so targets rebuild. Task 4 records `make -C projects/synth test` (incl. UI-boundary), `git diff --check`, strict OpenSpec validation, and apply state `12/12 all_done`. No code-reading doubt justifies rerunning suites.

### Recommendations

- Optionally validate `voiceCount` before drawing entropy in the default `NoiseModulatorProcessor` constructor (Minor #1).
- Optionally clamp `wholeColumns` against absurd widths in `NoiseWaveformVisualizer::DrawVisible` (Minor #2).
- Optionally enrich the `spv-6` coverage note to name the five-slot/index-4 topology (Minor #4).

None are merge-blocking.

### Assessment

**Ready to merge?** Yes

**Reasoning:** Every modified/added OpenSpec requirement is implemented and backed by behavior-proving deterministic tests; the DSP hot path is verifiably allocation/lock/entropy/exception-free with structurally enforced pointer stability, and the MiniApp integration is correctly scoped to index 4 with index 3 left as a clean boundary. Only four low-impact Minor notes remain, so no Critical or Important finding blocks the gate.