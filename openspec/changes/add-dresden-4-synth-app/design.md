## Context

The synth library already supports manager-owned parameter groups with independent voice and modulator counts, banks that map arbitrary manager-owned `Parameter*` values, bank-slot UI state sized to the manager's maximum voice count, pointer-backed modulation sources, wavetable VCO processors, scope publication, portable UI trees, and typed Sheaf Patch app registrations. Those contracts are sufficient for a bank containing stereo, quad, and monophonic parameters and for feeding four address-stable mixer outputs into the four voices of one parameter-group modulator.

The existing reusable `WavetableVcoModule<Polyphony>` is not the Dresden topology: its parameters all share one polyphony, it owns one parameter set spread across voices, and its phase and gain ranges differ. Dresden 4 instead owns four oscillator processors, three parameter groups with different voice counts, fourteen mapped parameters in a sixteen-position layout, and a stereo XY mix. A separate matrix module contributes sixteen parameters to the same monophonic group and exposes them through a second bank.

Four current seams need focused generalization. Scope waveform command construction is coupled to the MiniApp namespace even though the underlying scope data is generic; the Sheaf Patch application object stores a MiniApp-specific runtime-session type even though registrations are otherwise generic; `BufferResampler` allocates and processes whole buffers rather than providing a steady-state audio-thread decimator; and parameter-group smoothing/cadence values are fixed at group creation even though the actual device rate arrives later in `PrepareToPlay`. Dresden should not work around any of those contracts locally.

## Goals / Non-Goals

**Goals:**

- Provide a JUCE-free reusable `Dresden4VcoModule` that owns four default wavetable VCO processors and exposes natural-unit input, post-gain oscillator outputs, stereo outputs, scope connections, and UI state while reserving `Dresden4LfoModule` as a future sibling name.
- Preserve the requested sixteen-position control layout using native two-, four-, and one-voice parameter groups in one bank.
- Provide a reusable `BipolarMatrixMixerModule<Size>` with row-major parameter registration, identity defaults, and bipolar zero-based exponential gain mapping.
- Route the 4x4 mixer's four outputs into modulator index `0` of Dresden's quad group at audio rate.
- Run parameter sampling, VCO processing, matrix feedback, modulation publication, and scope advancement at exactly four times the negotiated host rate—192 kHz when the preferred 48 kHz host rate is obtained—including a one-internal-sample modulation delay.
- Downsample only the completed stereo XY result through an explicit allocation-free 4:1 anti-alias decimator to the negotiated host clock.
- Add a headless-testable, JUCE-free Dresden 4 application and portable 2x2 waveform/4x4 encoder UI, launchable from Sheaf Patch.
- Make the minimum shared-library changes needed for reusable fixed-factor oversampled output processing, streaming FIR decimation, rate-aware parameter timing, reusable waveform drawing, and app-agnostic runtime-session ownership.

**Non-Goals:**

- A standalone Dresden 4 executable or app bundle.
- More oscillator types, wavetable loading, MIDI note tracking, envelopes, synth filters, sequencers, input upsampling, variable oversampling ratios, or anti-feedback compensation.
- Additional modulators beyond the matrix source, prewired modulation-depth values, more than two global scenes, or gestures.
- Output limiting, normalization, or automatic gain compensation for the matrix or stereo mix.
- A redesign of the generic parameter-group, bank, patch, or portable UI models.

## Decisions

### Decision 1: Model Dresden and its matrix with exactly three native parameter groups

`Dresden4VcoModule::RegisterParameters` accepts three manager-owned groups:

- Stereo group: `numVoices=2`, `numModulators=0`, `numScenes=2`, with top-level X and Y parameters.
- Quad group: `numVoices=4`, `numModulators=1`, `numScenes=2`, with Tune, Phase, Shape, and Gain parameters. Its storage capacity includes four possible lazy modulation-depth controls in addition to the four top-level controls.
- Mono group: `numVoices=1`, `numModulators=0`, `numScenes=2`, with four PM Index, four Frequency, and sixteen matrix-gain parameters.

The matrix module registers into that same monophonic group after Dresden registers its eight oscillator-detail parameters, so the group has twenty-four top-level parameters. Scene value storage remains group-local, but the selected endpoint pair and blend are manager-global; manager validation requires both selected indices to exist in every group and computes effective scene capacity as the minimum group capacity. Giving every Dresden group exactly two scenes therefore yields one coherent global scene selector/fader with endpoints `0/1` across both banks.

This is directly supported by the current library: a bank is not associated with one group, and slot UI state uses the maximum voice count across all groups. The Dresden bank therefore maps parameters from all three Dresden groups, while the matrix bank maps its own group; both banks associate with the same single sixteen-encoder slot.

Alternatives considered:

- Put every control in one four-voice group. This invents unused voices for X/Y and the monophonic controls, obscures their UI meaning, and makes persistence/modulation state larger and less precise.
- Make every oscillator value a separate monophonic parameter. This represents the bank visually but bypasses native quad modulation and voice indicators.
- Encode the matrix as four quad-voice parameters. This reduces the top-level parameter count but makes one physical encoder represent four matrix cells, defeating the requested 4x4 editing surface and identity-matrix legibility.
- Give the matrix its own monophonic group. The parameter system permits it, but the matrix has the same one-voice, two-scene, zero-modulator shape as the oscillator-detail parameters, so a fourth group adds no semantic value.

### Decision 2: Treat the first bank as a sixteen-position layout with fourteen parameters

The Dresden bank layout is zero-based:

| Position | Mapping | Group/voices | Natural mapping |
| --- | --- | --- | --- |
| 0 | X | stereo / 2 | linear `[0, 1]` per output channel |
| 1 | Y | stereo / 2 | linear `[0, 1]` per output channel |
| 2-3 | disconnected | none | reserved |
| 4 | Tune | quad / 4 | exponential `0.5x` to `2x`, normalized midpoint maps to `1x` |
| 5 | Phase | quad / 4 | bipolar linear `-1` to `1` cycles |
| 6 | Shape | quad / 4 | linear `[0, 1]` wavetable position |
| 7 | Gain | quad / 4 | bipolar linear `-1` to `1` |
| 8-11 | PM Index 1-4 | mono / 1 each | zero-based exponential `0` to `1`, normalized midpoint maps to `0.25` |
| 12-15 | Frequency 1-4 | mono / 1 each | exponential ranges `10-160`, `50-800`, `250-2000`, and `1000-16000` Hz |

Every registered parameter has `Color::Red`. Positions 2 and 3 are genuinely disconnected cells rather than dummy parameters, so the module owns fourteen top-level parameters even though its bank contract spans sixteen positions. Because `Bank::RegisterParameters` rejects nulls and only maps contiguous spans, Dresden's bank registration uses explicit mappings or three contiguous chunks and leaves those positions untouched.

Defaults are X/Y `0.5`, Tune `1x`, Phase `0`, Shape `0`, Gain `1`, PM Index `0`, and each Frequency at its normalized midpoint. These defaults produce sound without introducing a default feedback modulation depth. The matrix defaults to identity.

### Decision 3: Keep DSP inputs natural and bind oscillator units explicitly

For oscillator `i`, Dresden maps parameters into a natural-unit voice input containing base frequency in Hz, tune multiplier, PM index, phase offset in cycles, wavetable position, and bipolar linear gain. Immediately before calling the underlying `DefaultWavetableVco`, the module computes:

- `freq = (baseFrequencyHz * tuneMultiplier) / sampleRate`, because the processor consumes cycles per sample. Dresden sets that module sample rate to exactly four times the negotiated host rate.
- `phaseOffset = phaseCycles * pmIndex`, because the processor consumes cycle offsets; `[-1, 1]` already represents one complete revolution backward or forward and does not need radians.
- `wavetablePosition = shape` and `maxFreq = 0.5`.

The underlying processor sample is multiplied by Gain and stored as the module's per-oscillator output. These four post-gain, pre-XY-mix outputs are the matrix inputs. Scope holders remain attached directly to the four underlying VCO processors, so visualized “raw VCO” samples are pre-gain; the module exposes one scope-holder setter and one VCO UI-state element per oscillator. The app can satisfy this with one four-channel `ScopeWriter` plus four `ScopeWriterHolder` values, matching existing scope architecture without allocating four independent ring buffers.

Alternatives considered:

- Pass Hz or radians through to the processor. This conflicts with its existing cycles-per-sample and cycles contracts.
- Scope the post-gain samples. This would make ring modulation erase or invert the oscillator trace instead of showing the requested raw oscillator waveform.

### Decision 4: Use separable equal-power XY weights independently for left and right

Parameter 0 supplies X and parameter 1 supplies Y. Voice `0` of each parameter controls the left channel, and voice `1` controls the right channel. For a normalized axis value `t`, define `a(t) = cos(pi*t/2)` and `b(t) = sin(pi*t/2)`. With oscillator order laid out as a 2x2 grid—1 top-left, 2 top-right, 3 bottom-left, 4 bottom-right—the per-channel output is:

`a(x)a(y)o1 + b(x)a(y)o2 + a(x)b(y)o3 + b(x)b(y)o4`.

The four squared weights sum to `(a(x)^2 + b(x)^2) * (a(y)^2 + b(y)^2) = 1`, preserving expected power for uncorrelated oscillators while either axis moves. No limiter or post-normalization is applied because the design assumes no phase coherence; coherent or correlated sources can sum above unity. This formula gives the waveform grid and spatial controls one shared, testable geometry.

Alternatives considered:

- Linear bilinear weights. Their amplitudes sum to one, but uncorrelated-source power falls by 3 dB at the midpoint of a one-axis fade and by 6 dB at the XY center.
- Normalize the final sum dynamically. That makes gain depend on signal correlation and introduces a time-varying nonlinear stage rather than a predictable crossfade law.

### Decision 5: Make the matrix row-major, unclamped, source-address-stable, and normalized at the modulation boundary

`BipolarMatrixMixerModule<Size>` registers `Size * Size` monophonic bipolar parameters in row-major order and maps each with `GetBipolarZeroBasedExponential(1.0, 0.25, ...)`. Diagonal defaults are `+1`; off-diagonal defaults are `0`. Processing computes `output[row] = sum(input[column] * gain[row][column])` without clamping or normalization. Inputs and outputs use fixed-size arrays so output addresses remain stable.

The Dresden app registers four address-stable normalized modulation-source values as modulator index `0` of the quad group, named `Dresden Matrix`. Each normalized value is derived from the corresponding raw matrix output `m` as `0.5 + 0.5 * clamp(m, -1, 1)`, so `m=-1`, `0`, and `+1` become normalized source values `0`, `0.5`, and `1`. Matrix DSP outputs remain linear and unclamped for tests, inspection, and future consumers; only the existing parameter-modulation boundary receives the clamped normalized adapter. This preserves the current parameter system's implicit `[0,1]` modulation-source calibration and makes modulation-depth UI ranges truthful instead of allowing an unbounded source to saturate targets at a few percent of depth travel.

Within each internal sample at four times the host rate it:

1. Processes all three parameter groups for the absolute internal sample index.
2. Maps and processes Dresden's four VCOs and stereo mix.
3. Copies Dresden's post-gain oscillator outputs into the matrix, maps matrix gains, and processes it.
4. Clamps and normalizes the four matrix outputs into the modulation-source adapter.
5. Calls the manager/group modulation-source update so the normalized matrix values become the quad group's next sampled modulation values.
6. Advances the scope writer and submits Dresden's left and right results to the final stereo decimator.

This preserves the parameter system's existing one-sample modulation delay at the oversampled clock: `1 / (4 * hostRate)` seconds, approximately `5.208 µs` at a 48 kHz host rate. A zero-delay loop would require a new solver/order contract and is explicitly out of scope.

### Decision 6: Build Dresden as a JUCE-free app with one slot and two banks

`Dresden4Core` owns the module graph, three groups, one sixteen-encoder bank slot, a red Dresden bank, a red matrix bank, a four-channel scope writer, a reusable oversampled output stage, and default sixteen-encoder controller configuration. It exposes only stable accessors needed by `Dresden4UiSurface`. `Dresden4` wraps the core and attaches the portable surface, following the current MiniApp split.

The app config requests zero inputs, two outputs, a preferred host rate of 48 kHz, block size 256, and a runtime-sized portable surface. `PrepareToPlay` accepts the negotiated positive host rate and configures every Dresden timing dependency from `internalRate = 4 * hostRate`. The app initializes two scenes, global endpoints `0/1`, no gestures, and a default WRLD.Bldr-compatible controller profile with sixteen visible encoders, two scene selectors plus one scene blend control, and enough bank selectors for the two banks. Bank selection is available through existing parameter-bank messages/controller mappings.

Dresden always computes an internal stereo pair. When the actual device exposes one output channel, the app writes a deterministic mono fold `0.5 * (left + right)` to channel `0`. When the device exposes two or more output channels, it writes left to channel `0`, right to channel `1`, and clears every channel above `1` to silence. This keeps the requested stereo behavior intact while avoiding stale or duplicated data on devices whose actual channel count differs from the requested count.

The four-channel scope writer uses an explicit capacity of `6'553'600` internal frames, matching the existing MiniApp frame count while documenting the four-times-rate consequence. At the preferred 48 kHz host rate this stores about `34.13` seconds of Dresden internal samples; at other host rates the stored duration scales as `6'553'600 / (4 * hostRate)`.

Headless tests run the core through `SynthRig`, select each bank through production messages, turn controls, verify finite/non-silent stereo output, verify left/right XY isolation at the four corners, verify matrix-driven modulation after the documented internal-sample delay, verify four internal steps for every captured host frame, and verify patch round trips across all three groups.

### Decision 7: Drive a four-times-host clock and decimate the final stereo result 4:1

Each negotiated-rate host output frame runs exactly four internal subframes. The absolute parameter sample index is derived without a second drifting clock as `4 * (block.startSample + hostFrameIx) + subframeIx`, for `subframeIx` in `0..3`. Every subframe performs parameter `ProcessSample`, VCO processing, matrix processing, modulator publication, and scope advancement. Only after the fourth subframe does the decimator produce the corresponding host stereo frame. The host block size remains expressed in host frames, while the steady-state DSP cost is four internal graph evaluations per host frame.

The three parameter groups use rate-correct settings derived from `internalRate = 4 * hostRate` rather than blindly applying the 48 kHz defaults:

- `processLiteAlpha = 1 - pow(1 - kDefaultProcessLiteAlpha, 48000 / internalRate)`.
- `uiDisplayCenterAlpha = 1 - pow(1 - kDefaultUiDisplayCenterAlpha, 48000 / internalRate)`.
- `uiDisplaySpreadAlpha = 1 - pow(1 - kDefaultUiDisplaySpreadAlpha, 48000 / internalRate)`.
- `targetComputeIntervalSamples = max(1, round(16 * internalRate / 48000))`, preserving the default wall-clock target cadence within one internal sample while `ProcessLite` and current modulation sampling still run on every internal sample. At a 48 kHz host rate these values reduce to the fourth-root alpha conversions and a 64-internal-sample target interval.

The parameter library gains reusable pure helpers for converting a reference one-pole alpha and reference sample interval to another positive processing rate, plus a narrow `ParameterGroup::ConfigureProcessingTiming(...)`-style API callable while audio is stopped during prepare/device changes. It validates the three alphas and nonzero interval, updates only the timing fields observed by `ProcessSample`/UI smoothing, preserves voice/modulator/scene/capacity topology and all parameter values/storage, performs no allocation, and is repeatable without compounding because Dresden always derives new values from the 48 kHz reference constants.

The reusable layer has two parts. `FirDecimator<Factor, Channels, Taps>` (or equivalently named fixed-ratio template) owns fixed storage, persistent history, reset, and coefficient-driven integer decimation. `OversampledOutputStage<Factor, Channels, Decimator>` (or an equivalent composition) accepts a templated generator callable for one host frame, invokes it once per internal subframe with the derived absolute internal sample index, feeds each generated multichannel frame through the decimator, and returns exactly one host-rate frame. The callable path is statically bound and performs no allocation or type erasure. This keeps clock/index/decimator mechanics reusable for later Dresden or unrelated synth graphs while leaving parameter/VCO/matrix ordering inside the app-supplied generator.

Dresden instantiates the reusable stage at factor four, stereo, with a 287-tap symmetric linear-phase low-pass designed as a Kaiser-windowed sinc: Kaiser `β=9`; ideal cutoff `11/24 * hostRate`; passband edge `5/12 * hostRate`; stopband edge `1/2 * hostRate`; coefficients normalized to unity DC gain; passband ripple no greater than 0.1 dB; and measured stopband rejection of at least 90 dB. At a 48 kHz host rate those edges are 22 kHz, 20 kHz, and 24 kHz respectively. Because the internal rate is always four times the host rate, the normalized coefficients are constant across device rates. Its deterministic group delay is 143 internal samples, `143 / (4 * hostRate)` seconds (about `0.745 ms` at 48 kHz); no dry path exists, so no latency compensation is required.

Filter coefficients are compile-time/static immutable data or are generated before audio starts, never in steady-state processing. Both channel histories and the decimation phase reset on prepare. The VCO/matrix/stereo result is finite-checked in tests before and after decimation. The existing `BufferResampler` is not used because it allocates, copies whole buffers, rounds output lengths, and does not preserve continuous filter/phase state across host blocks.

No new runtime rate policy is required. The runtime continues to negotiate the device rate and pass the actual value to `PrepareToPlay`; Dresden uses that value consistently for its four-times clock, VCO normalization, parameter coefficients, target cadence, FIR interpretation, and latency accounting.

Alternatives considered:

- Run only the oscillators at four times the host rate. This leaves parameter modulation and the feedback delay at the host rate, defeating the reason for oversampling.
- Use `BufferResampler` per host block. Its allocations, block-edge filter resets, and rounded frame counts are unsuitable for the real-time path.
- Use the existing 8th-order Butterworth followed by sample dropping. It is inexpensive but does not provide enough rejection across the narrow 20–24 kHz transition band for heavily modulated ultrasonic content.
- Fix the internal rate at 192 kHz and rationally resample to whatever rate the device negotiates. This requires a more complex asynchronous rate converter and would make the feedback clock independent of the runtime's real audio clock without a corresponding product need.

### Decision 8: Share portable waveform drawing instead of coupling apps

Move the generic “scope channel to bounded polyline commands” logic from MiniApp-specific drawing code into a JUCE-free shared portable UI builder. MiniApp keeps its visual behavior by delegating to the shared helper. Dresden creates four independent draw nodes using one VCO UI state and one quadrant bound per node, rather than using the current `VcoWaveformComponent`, which overlays all supplied traces.

The Dresden main surface uses a near-black/deep-space background, four red waveform panels in a 2x2 grid, sixteen red encoder widgets in a 4x4 grid bound to slot `0`, positions `0..15`, and a compact global two-scene selector/blend strip. Disconnected positions render as disconnected encoder cells. The layout may place waveform and encoder grids side-by-side or stack them responsively, but both complete grids and the scene strip remain visible on the default screen without scrolling.

Alternatives considered:

- Include MiniApp drawing headers from Dresden. This creates a reverse app-to-app dependency and makes later UI changes unsafe.
- Duplicate the scope-reader/draw math. This is quick but creates two subtly divergent scope rendering contracts.

### Decision 9: Type-erase launched runtime sessions in Sheaf Patch

The launcher already stores type-erased registration callables, but `SheafPatchApplication` currently owns `RuntimeShellSession<MiniApp>` directly. Introduce a minimal session-owner interface with a virtual destructor and `Component()` access, implemented by a templated holder around `RuntimeShellSession<App>`. A generic launch helper/factory constructs that holder from a registration and runtime data paths. `SheafPatchApplication` then owns one `unique_ptr` to the interface and does not add a Dresden-specific runtime member or launch method.

The registry adds manifest `appId="dresden-4"`, display name `Dresden 4`, category `synth`, author `Sheaf`, and minimum encoder count `16`. The existing app-id path policy automatically isolates Dresden patches under `patches/dresden-4`. No standalone `Main.cpp` or Dresden build target is added.

Alternatives considered:

- Add a second typed pointer and `LaunchDresden4` method to `Main.cpp`. This works for two apps but violates the registry's intended thin-launcher boundary and repeats for every future app.
- Keep session ownership inside an opaque callback. This complicates lifetime, window-component access, and shutdown ordering.

## Risks / Trade-offs

- [Matrix sums can reach magnitude four] → Keep the mixer linear/unclamped as specified, but clamp and normalize only at the existing parameter-modulation boundary; cover raw matrix extremes, normalized-source anchors, and finite output in tests.
- [Equal-power weights can exceed unity amplitude for coherent oscillators] → Document the uncorrelated-source assumption, apply no hidden limiter, and test both independent and deliberately coherent inputs so the gain law is explicit.
- [Audio-rate self-modulation is delayed one internal sample] → Specify and test the four-times-host update order and its `1 / (4 * hostRate)` delay rather than implying a zero-delay feedback network.
- [The 287-tap decimator adds CPU cost and 143 internal samples of latency] → Use polyphase fixed-ratio processing, immutable coefficients, fixed storage, release-build deadline tests, and no latency compensation because Dresden has no parallel dry path. Release deadline coverage uses a 256-host-frame block benchmark at 44.1, 48, and 96 kHz and fails if average callback CPU time exceeds 25% of the real-time block duration or p99 exceeds 50% on the project baseline runner.
- [Changing devices changes the absolute internal rate] → Derive every oscillator, parameter, filter, delay, and cadence quantity from the negotiated rate in one prepare path and test at 44.1, 48, and 96 kHz.
- [Four oscillator scopes plus sixteen encoders are dense at small window sizes] → Define a default size that shows both complete grids and use responsive bounds while preserving 2x2/4x4 structure.
- [Quad-group lazy modulation controls require more storage than its four visible parameters] → Size the group for its four top-level parameters plus one possible depth control per parameter and test opening each modulation view.
- [The phrase “sixteen params” conflicts with two blank positions] → Treat it as a sixteen-position bank contract with fourteen actual top-level parameters; blank cells stay disconnected and patch JSON contains no meaningless placeholders.
- [“Four scopewriters” could imply four buffers] → Preserve the library's holder-based processor API: four holder connections backed by one four-channel writer, which yields four independent traces with lower memory and synchronization cost.
- [Extracting waveform draw logic could regress MiniApp] → Add parity assertions for MiniApp draw commands before switching it to the shared helper.
- [Type-erased sessions touch launcher lifecycle] → Keep the interface minimal, preserve existing destruction order, and extend the launcher harness to launch both registered app types.

## Migration Plan

1. Add tests and implement the reusable matrix and Dresden modules without changing the current MiniApp.
2. Add and frequency-response-test the allocation-free FIR decimator, reusable fixed-factor output stage, and rate-aware parameter timing APIs.
3. Extract and parity-test the shared portable waveform helper.
4. Add the four-times-host Dresden JUCE-free core, portable UI, and headless/UI tests.
5. Introduce the type-erased runtime-session owner and migrate the existing MiniApp registration to it.
6. Register Dresden 4, extend Sheaf Patch build/harness coverage, and run the full synth and launcher builds.

Rollback removes the Dresden registration/app and the two new modules. The shared waveform helper and generic session owner can remain because MiniApp consumes them and their behavior is covered independently.

## Open Questions

None. The ranges omitted from the shorthand brief are bound here as PM Index `0..1` with `0.25` at normalized midpoint and matrix Gain `-1..1` with magnitude `0.25` at half travel. XY uses separable equal-power cosine/sine weights under an uncorrelated-source assumption. All three groups use two global scenes. The internal rate is exactly four times the negotiated host rate, yielding 192 kHz for the preferred 48 kHz host rate.
