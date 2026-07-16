## Context

MiniApp currently configures one two-voice `ParameterGroup` with three connected modulation sources: direct and swapped VCO outputs at indexes `0` and `1`, and a basic LFO at index `2`. A parallel branch adds a ganged random LFO at index `3`. This change must add simple audio-rate white noise without taking that branch's slot, recording noise into the scope system, or coupling its visual representation to the actual polyphonic random sequence.

The synth DSP layer favors processors with natural-unit inputs and no awareness of parameters, banks, pages, or controller layout. Pointer-backed modulation sources require their source floats to remain address-stable after registration. Portable visualizers are app-owned, non-copyable objects that emit backend-independent draw commands and may render without a DSP model when the picture is illustrative rather than historical.

## Goals / Non-Goals

**Goals:**

- Provide a runtime-sized processor that produces one independent unipolar white-noise sample per configured voice on every process call.
- Make the processor cheap and allocation-free on the audio path, with stable output addresses suitable for `ParameterGroup::SetModulationSource`.
- Provide explicit seeding for deterministic tests and normal construction with a one-time initialization seed.
- Render a clearly noisy, monophonic portable waveform that regenerates on every UI draw and does not read actual DSP output.
- Register a two-voice noise source and its visualizer at MiniApp modulator index `4` while leaving index `3` untouched by this change.

**Non-Goals:**

- No cryptographic randomness, entropy guarantees, noise-color filters, sample-and-hold rate, smoothing, amplitude parameter, or bipolar output.
- No processor `UIState`, scope writer channels, audio-history recording, or polyphonic noise visualization.
- No parameter, page, bank, patch-persistence, backend-specific, or fourth-modulator implementation changes.

## Decisions

1. Use one runtime-sized `NoiseModulatorProcessor` rather than a compile-time template or an app-owned array of monophonic processors.

   Construction receives a positive voice count, allocates the output floats and a parallel array of pointers to those floats, and never resizes either collection. The processor is non-copyable and non-movable so registered pointers cannot be invalidated. It exposes the voice count, bounds-checked per-voice output access, and a span of stable source pointers that callers can pass to the existing modulation-source registration API.

   The processor does not receive a `ParameterGroup`, modulator index, metadata, or UI object. This keeps the DSP boundary consistent with `sdsp-15`; applications remain responsible only for choosing topology and metadata, without rebuilding storage or pointer plumbing.

   Alternative considered: `NoiseModulatorProcessor<Polyphony>` with `std::array` storage. That removes the constructor allocation but makes voice count a compile-time policy and does not match the requested initialization contract. Alternative considered: one scalar processor per voice. That keeps the primitive smaller but forces each application to recreate stable polyphonic output and registration storage.

2. Use a compact PCG32-style pseudorandom stream and an exact open-interval float mapping.

   Each voice consumes one 32-bit word from the same advancing stream per process call. The hot path uses the generator's small fixed state and integer arithmetic; it performs no allocation, locking, system entropy call, distribution-object setup, or exception path. The upper 23 random bits map to `(bits + 0.5) * 2^-23`, whose float endpoints are `2^-24` and `1 - 2^-24`, so every published value is strictly inside `(0, 1)` without clamping.

   An explicit seed constructor produces repeatable streams for tests. Normal construction obtains entropy only once during non-audio initialization and then uses the same fast generator. Exact statistical independence cannot be proven by unit tests, so deterministic range, sequence, per-voice advancement, bin/mean sanity, and pointer-publication tests define the practical contract.

   Alternative considered: `std::mt19937` plus `std::uniform_real_distribution<float>`. It is familiar and already appears in non-hot-path synth code, but has substantially larger state and a less explicit endpoint/reproducibility contract. Cryptographic generators are intentionally excluded because update cost matters more than adversarial unpredictability.

3. Give the noise visualizer its own generator and no model state.

   A concrete `NoiseWaveformVisualizer` derives from the portable `Visualizer` contract. For positive bounds, each `DrawVisible()` call generates a single colored polyline with a fresh random y value for every integer horizontal pixel column across the bounds. Every point is clamped geometrically inside the assigned bounds. The visualizer owns a separate mutable fast generator used only on the UI thread, and an explicit visualizer seed remains available for deterministic geometry tests.

   The visualizer does not retain processor output pointers, publish or consume `UIState`, allocate scope channels, show multiple voices, or attempt to match audio history. Consecutive draws deliberately differ so the open modulation view flickers like real noise.

   Existing requirement `sdsp-33` remains the contract for exactly three scope-backed MiniApp visualizer instances at indexes `0`, `1`, and `2`; its wording is updated to distinguish that scope-only count from the additional model-free noise visualizer governed by `sdsp-38` and `spv-7`.

   Alternative considered: capture the actual processor output through `ScopeWriter`. That would consume polyphonic scope storage and imply historical accuracy the user explicitly does not need. Alternative considered: generate one random path at construction. That avoids redraw motion but does not provide the requested real-noise flicker.

4. Integrate MiniApp at the final reserved index.

   MiniApp configures five modulator slots, constructs `NoiseModulatorProcessor(2)`, registers its stable source-pointer span at index `4` with `Noise` metadata, retains one `NoiseWaveformVisualizer`, and attaches that visualizer only to index `4`. Its per-sample loop processes noise after the existing signal modulators and before `UpdateModValues`, so the group dereferences the new values from the same sample.

   This change does not call `SetModulationSource`, alter metadata, or attach a visualizer at index `3`. On the current base that slot remains empty; after the parallel branch is integrated, its ganged random LFO can occupy index `3`. Noise adds no parameter, bank position, page, scope channel, or audio-output routing.

5. Verify contracts at their owning boundaries.

   JUCE-free DSP tests cover construction validation, deterministic seeding, strict `(0, 1)` output, voice advancement, distribution sanity, address stability, and successful registration/update through `ParameterGroup`. Portable UI tests cover per-pixel bounded geometry, monophonic output, absence of model dependencies, deterministic explicit seeding, and different consecutive draws. MiniApp system tests cover five-slot topology, preserve `sdsp-33` coverage for the three scope-backed visualizers, cover noise metadata and the separate model-free visualizer at index `4`, verify per-sample publication, and preserve index `3` as an unclaimed integration boundary rather than asserting that it must remain disconnected forever.

## Risks / Trade-offs

- [Risk] Runtime-sized vectors can invalidate registered pointers if resized or moved. → Mitigation: allocate once in the constructor, expose no resize API, and make the processor non-copyable and non-movable.
- [Risk] A weak or accidentally zero generator state could produce a degenerate sequence. → Mitigation: use PCG32-style state/stream initialization that accepts every seed and add deterministic sequence plus distribution-sanity tests.
- [Risk] Per-pixel redraws allocate and generate more values as the component widens. → Mitigation: keep this work on the UI thread, emit one polyline, and perform no DSP/UI synchronization or scope reads.
- [Risk] A flickering random line is intentionally nondeterministic in production and cannot reproduce audible history. → Mitigation: document it as illustrative, keep the DSP and UI generators separate, and use explicit seeds only in tests.
- [Risk] The parallel fourth-modulator branch changes the same MiniApp group-count and visualizer topology region. → Mitigation: define the combined count as five, reserve noise at index `4`, make no index-`3` registration, and resolve any textual merge at integration to retain both sources.
