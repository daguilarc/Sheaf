## Context

`Parameter::ProcessLite()` currently performs three inseparable operations: it slews current parameter state, samples `GetRaw()` into a normalized per-voice cache, and updates the UI display-center/spread EMAs from that cache. Mapping helpers and module `SetInput()` methods later read the cache, so the cache is already the single value boundary shared by DSP and UI. Braid 4 needs to transform selected cache entries at that boundary without a virtual hook in its four-times-host inner loop.

Braid 4 owns two `Braid4VcoModule` instances and two `BipolarMatrixMixerModule<4>` instances spread across stereo, quad, and mono parameter groups. The existing low-pass implementation already owns a scalar filter state and computes the conventional alpha `1 - exp(-2*pi*cutoff/sampleRate)`, but its `Process(Input)` recomputes alpha on every call. Applying that operation independently to every owned parameter voice would repeat the expensive coefficient calculation many times.

## Goals / Non-Goals

**Goals:**

- Make cache transformation an explicit, allocation-free, non-virtual parameter-processing pattern reusable by compile-time-known application code.
- Ensure the transformed cache, rather than the raw phase-1 sample, drives both mapping helpers and UI smoothing.
- Low-pass every Braid 4 oscillator-owned top-level value except XY, including the cutoff controls themselves, with one state per value and one coefficient calculation per oscillator per internal sample.
- Low-pass every audible and LFO matrix entry and make its ownership unambiguous: the output row owns each of its four gains and supplies their cutoff.
- Preserve Braid 4's group topology, parameter count/order, matrix feedback delay, four-times-host clock, and ordinary `ProcessLite`/`ProcessSample` behavior for other callers.

**Non-Goals:**

- Adding runtime callbacks, virtual processors, type-erased hooks, or application policy to the generic parameter system.
- Filtering X/Y, recursively materialized modulation-depth parameters, raw oscillator audio, matrix audio, or published modulation-source samples.
- Changing Braid's oscillator frequency ranges, XY mix, matrix gain curve, oversampling, or decimator.
- Migrating old PM values into perceptually equivalent cutoff values; the four stable controls deliberately acquire new semantics.

## Decisions

### 1. Split both parameter and group processing into explicit phases

`Parameter` gains `ProcessLitePhase1()` and `ProcessLitePhase2()`. Phase 1 performs all current state/depth slewing and samples `GetRaw()` into every normalized cached knob. Phase 2 performs only the UI display-center/spread updates from the cache's then-current values. `ProcessLite()` remains a convenience wrapper that calls the two phases consecutively.

The per-sample layer mirrors that shape: `Parameter::ProcessSamplePhase1(sampleIndex)` performs the cadence-controlled `Compute()` followed by lite phase 1, and `ProcessSamplePhase2()` performs lite phase 2. `ParameterGroup` exposes matching top-level-only traversal methods, while `ProcessSample()` calls group phase 1 then group phase 2. This gives Braid a group-safe seam without exposing or rediscovering the group's private top-level set.

Alternative considered: a callback passed to `ProcessLite()`. That would put policy and indirect invocation in the tight loop and would not provide the requested compile-time-known application sequence.

### 2. Expose a narrow normalized cache replacement operation

`Parameter::ReplaceCachedKnobValue(voiceIx, normalizedValue)` replaces one phase-1 cache entry after validating the voice and clamping the supplied value to `[0,1]`. It does not mutate raw/current/target state, UI EMA state, range state, or nested modulation data. Braid uses direct parameter IDs and compile-time-sized loops to invoke it between group phases.

Alternative considered: returning mutable spans or references to cache storage. A named replacement operation retains the normalized-domain invariant and avoids exposing arena layout or bulk mutation outside the intended seam.

### 3. Reuse `OnePoleLowPass` with a precomputed-alpha operation

The existing class gains `ProcessWithAlpha(value, alpha)` and `Reset(output)`. `Process(Input)` computes alpha from cutoff and delegates to `ProcessWithAlpha`; the new operation stores the supplied coefficient for UI/inspection and advances state as `output += alpha * (value - output)`. The alpha contract is `[0,1]`.

This avoids a duplicate "basic" filter type and keeps existing callers source-compatible. Braid computes `OnePoleLowPass::AlphaFromNatFreq(cutoffHz / internalRate)` once for each of eight oscillators on each internal sample, then reuses that alpha for all ten filter states owned by that oscillator.

### 4. Store filters by signal family and oscillator ownership

Braid owns two compile-time arrays (audible and LFO), each containing four oscillator filter bundles. Each bundle contains:

- four states for that oscillator's voices of Tune, Phase, Shape, and Gain;
- one state for that oscillator's monophonic Frequency parameter; and
- one state for that oscillator's monophonic Mod LPF Cutoff parameter;
- four states for columns `0..3` of the matrix output row with the same oscillator index.

This is ten states per oscillator, 40 per bank family, and 80 total. Every one of the 16 audible and 16 LFO matrix entries therefore has its own filter state. Parameter IDs are resolved during initialization; no name lookup, allocation, ownership search, or virtual call occurs per sample.

The eight LPF Cutoff controls are both coefficient sources and filtered values. For each oscillator, Braid reads the cutoff's pre-Mod-LPF phase-1 cache—after ordinary parameter-state slew but before this application-owned filter—maps that value to one alpha, and then uses that alpha to advance all ten owned states, including the cutoff state itself. It replaces the cutoff cache with the filtered cutoff output before phase 2, just like every other owned value. Using the phase-1 cutoff as the coefficient source avoids an implicit/circular solve while applying the requested slew to the authoritative cutoff cache. Only X/Y and local modulation-depth parameters are excluded.

Matrix ownership follows output rather than source: gain `[row][column]` is filtered, is owned by oscillator `row`, and uses oscillator `row`'s cutoff regardless of `column`. Thus all four gains contributing to output `i` use oscillator `i`'s cutoff, for both the audible and LFO matrices.

### 5. Replace PM depth controls in place with cutoff controls

`Braid4VcoModule::ParameterIds::pmIndex` becomes an oscillator-indexed cutoff ID array. Registration count and order stay fixed: positions `8..11` become `Mod LPF 1..4`, while positions `12..15` remain Frequency 1..4. Each cutoff is a normalized unipolar parameter with default `0`, mapped exponentially from `0.1 Hz` to `20,000 Hz`. The LFO module's `frequencyOctaveShift` applies only to oscillator Frequency and never to cutoff, so audible and LFO cutoff ranges match exactly.

Old patches load by the same stable registration order/IDs, but old PM values now mean cutoff values. This semantic break is intentional and documented rather than hidden behind migration heuristics.

### 6. Filter between phase 1 and phase 2 before module extraction

For internal sample `n`, Braid keeps the existing standard-modulator processing and group modulator refresh, then:

1. runs phase 1 for stereo, quad, and mono top-level parameters;
2. reads the eight cutoff caches and computes eight alphas;
3. advances and writes back all 80 owned cached values, including all cutoff and matrix caches;
4. runs phase 2 for the three groups;
5. calls module/matrix input mapping and DSP processing; and
6. publishes matrix outputs for sample `n+1` parameter evaluation as before.

The oscillator phase-offset input becomes the filtered Phase value directly. There is no remaining PM depth multiplier outside this filtering stage. Since UI smoothing runs only after replacement and mapping helpers run later, UI and DSP consume the same filtered cache.

### 7. Seed filter state from current caches on reset/prepare

Initialization and audio preparation seed every filter output from its associated parameter's current cached value. This avoids a synthetic ramp from zero and leaves only subsequent cache motion subject to the selected cutoff. A reset does not change parameter targets or patch state.

## Risks / Trade-offs

- [Very low cutoffs make direct knob edits appear slow as well as suppressing modulation] → This follows from filtering the authoritative combined cached value; tests will state that both DSP and UI track the same response.
- [The maximum 20 kHz setting is not mathematically bypassed at a four-times-host rate] → Keep the requested physical cutoff and test the exact one-pole response rather than claiming bit-transparent bypass.
- [Old PM values change meaning on load] → Preserve IDs/order for structural compatibility, rename labels clearly, and cover save/load with cutoff semantics.
- [A missed parameter-to-oscillator mapping would silently use the wrong alpha] → Centralize ownership tables in compile-time arrays and test every quad voice, frequency, and matrix row/column independently for both families.
- [More filters increase the four-times-host deadline cost] → Reuse eight coefficients across 80 scalar updates, preserve allocation-free processing, and rerun representative-rate release deadline tests.

## Migration Plan

1. Add and test the generic two-phase parameter APIs while retaining wrappers.
2. Add and test precomputed-alpha/reset operations on the existing one-pole low-pass.
3. Rename the four module parameter IDs/labels and remove PM multiplication without changing registration order.
4. Add Braid-owned filter bundles, cache seeding, ownership mapping, and phased processing.
5. Update persistence/layout/system/deadline coverage and documentation mappings.

Rollback is a source rollback. Patch files written during this change remain structurally readable by the prior build because parameter topology and serialized order remain unchanged, although the four controls' meanings differ across versions.

## Open Questions

None.
